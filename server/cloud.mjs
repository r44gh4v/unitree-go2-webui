// Unitree cloud client - used for the Remote connection method, where the robot
// is not on the local network. Login yields a token; the token yields the bound
// device list (including each robot's per-device AES key) and TURN credentials;
// the SDP offer is then relayed through the cloud instead of over the LAN.
//
// Ported from legion1581/unitree_webrtc_connect unitree_cloud.py.

import crypto from 'node:crypto'
import { aesDecrypt, aesEncrypt, generateAesKey, loadPublicKey, rsaEncrypt } from './crypto.mjs'

const APP_SIGN_SECRET = 'XyvkwK45hp5PHfA8'

const BASE_URLS = {
  global: 'https://global-robot-api.unitree.com/',
  cn: 'https://robot-api.unitree.com/',
}

const APP_NAME = { Go2: 'Go2', G1: 'B2', R1: 'B2' }

const BASE_HEADERS = {
  'Content-Type': 'application/x-www-form-urlencoded',
  DeviceId: 'Samsung/Samsung/SM-S931B/s24/14/34',
  DevicePlatform: 'Android',
  DeviceModel: 'SM-S931B',
  SystemVersion: '34',
  AppVersion: '1.11.4',
  AppLocale: 'en_US',
  Channel: 'UMENG_CHANNEL',
  'User-Agent':
    'Mozilla/5.0 (Linux; Android 14; SM-S931B Build/AP3A.240905.015.A2; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/127.0.6533.103 Mobile Safari/537.36',
}

export class UnitreeCloud {
  constructor({ region = 'global', deviceType = 'Go2', accessToken = '' } = {}) {
    this.base = BASE_URLS[region] ?? BASE_URLS.global
    this.deviceType = deviceType
    this.accessToken = accessToken
    this.refreshToken = ''
  }

  headers() {
    const ts = String(Date.now())
    const nonce = crypto.randomUUID().replace(/-/g, '')
    const sign = crypto.createHash('md5').update(`${APP_SIGN_SECRET}${ts}${nonce}`).digest('hex')
    return {
      ...BASE_HEADERS,
      AppTimezone: 'UTC',
      AppTimestamp: ts,
      AppNonce: nonce,
      AppSign: sign,
      AppName: APP_NAME[this.deviceType] ?? 'Go2',
      Token: this.accessToken,
    }
  }

  async request(method, path, body) {
    const url = new URL(path, this.base)
    const init = { method, headers: this.headers() }
    if (method === 'GET') {
      for (const [k, v] of Object.entries(body ?? {})) url.searchParams.set(k, String(v))
    } else {
      init.body = new URLSearchParams(Object.entries(body ?? {}).map(([k, v]) => [k, String(v)])).toString()
    }
    const res = await fetch(url, init)
    const text = await res.text()
    try {
      return JSON.parse(text)
    } catch {
      throw new Error(`Cloud endpoint ${path} returned a non-JSON response`)
    }
  }

  /** Cloud replies use code 100 for success; anything else carries a message. */
  check(result, label) {
    if (result?.code !== 100) {
      throw new Error(`${label}: ${result?.msg ?? result?.message ?? `code ${result?.code}`}`)
    }
    return result.data
  }

  async loginEmail(email, password) {
    const result = await this.request('POST', 'login/email', {
      email,
      password: crypto.createHash('md5').update(password).digest('hex'),
    })
    const data = this.check(result, 'Cloud login')
    this.accessToken = data?.accessToken ?? ''
    this.refreshToken = data?.refreshToken ?? ''
    return this.accessToken
  }

  async listDevices() {
    const result = await this.request('GET', 'device/bind/list')
    return this.check(result, 'Device list') ?? []
  }

  async getPubKey() {
    const result = await this.request('GET', 'system/pubKey')
    return this.check(result, 'Public key') ?? ''
  }

  async webrtcAccount(sn, skRsaB64) {
    const result = await this.request('POST', 'webrtc/account', { sn, sk: skRsaB64 })
    return this.check(result, 'TURN credentials') ?? ''
  }

  async webrtcConnect(sn, skRsaB64, dataAesB64, timeout = 5) {
    const result = await this.request('POST', 'webrtc/connect', { sn, sk: skRsaB64, data: dataAesB64, timeout })
    if (result?.code === 1000) throw new Error('That robot is not online right now')
    return this.check(result, 'Cloud signaling') ?? ''
  }
}

/** Log in and return the token plus the robot list, with per-device keys attached. */
export async function cloudLogin({ email, password, region = 'global' }) {
  const cloud = new UnitreeCloud({ region })
  const token = await cloud.loginEmail(email, password)
  const devices = await cloud.listDevices()
  return {
    token,
    robots: (devices ?? []).map((d) => ({
      sn: d.sn ?? d.serialNumber ?? d.id,
      name: d.name ?? d.nickName ?? d.deviceName,
      online: d.online ?? d.status,
      // the per-device AES key doubles as the LAN handshake key on newer firmware
      aesKey: d.key ?? d.gcm_key ?? d.deviceKey ?? '',
      raw: d,
    })),
  }
}

/**
 * Fetch TURN credentials for a robot. The browser needs these to build its peer
 * connection BEFORE it makes the offer, because a remote robot is only
 * reachable through the same relay - so this is a separate step from signaling.
 */
export async function getCloudTurn({ sn, token, region = 'global' }) {
  const cloud = new UnitreeCloud({ region, accessToken: token })
  const pubPem = await cloud.getPubKey()
  if (!pubPem) throw new Error('The cloud did not return a public key')
  const publicKey = loadPublicKey(pubPem)

  const turnKey = generateAesKey()
  const encryptedTurn = await cloud.webrtcAccount(sn, rsaEncrypt(turnKey, publicKey))
  return encryptedTurn ? JSON.parse(aesDecrypt(encryptedTurn, turnKey)) : null
}

/** Relay the SDP offer through the cloud, given the TURN config already fetched. */
export async function signalViaCloud({ sn, sdp, token, region = 'global', turnServer = null }) {
  const cloud = new UnitreeCloud({ region, accessToken: token })
  const pubPem = await cloud.getPubKey()
  if (!pubPem) throw new Error('The cloud did not return a public key')
  const publicKey = loadPublicKey(pubPem)

  // The robot connects to the same relay the browser used, so the exact TURN
  // config has to travel inside the offer envelope.
  if (!turnServer) turnServer = await getCloudTurn({ sn, token, region })

  const offerJson = JSON.stringify({
    id: '',
    turnserver: turnServer,
    sdp: sdp.sdp,
    type: sdp.type,
    token,
  })

  const sessionKey = generateAesKey()
  const encryptedAnswer = await cloud.webrtcConnect(
    sn,
    rsaEncrypt(sessionKey, publicKey),
    aesEncrypt(offerJson, sessionKey),
  )
  const answer = JSON.parse(aesDecrypt(encryptedAnswer, sessionKey))
  if (answer.sdp === 'reject') {
    throw new Error('Robot refused the connection - another client already holds the session')
  }
  return { sdp: answer.sdp, type: answer.type, turnServer }
}

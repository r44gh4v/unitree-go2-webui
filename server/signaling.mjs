// SDP exchange with the robot over the LAN.
// Two flows exist depending on firmware; the port probe picks one:
//   :9991 /con_notify + /con_ing_<ending>  - newer firmware, encrypted
//   :8081 /offer                           - legacy Go2 (pre 1.1.11), plaintext

import { probePort } from './discovery.mjs'
import {
  aesDecrypt,
  aesEncrypt,
  calcLocalPathEnding,
  decryptData1Legacy,
  decryptData1V3,
  generateAesKey,
  loadPublicKey,
  rsaEncrypt,
} from './crypto.mjs'

/**
 * What the robot's HTTP status actually means to an operator. The board runs
 * one WebRTC client at a time, so 429 is by far the most common failure and
 * says nothing useful on its own. Status meanings follow the same reading as
 * legion1581/unitree_ui, which hit all three against real hardware.
 */
function explainStatus(status) {
  if (status === 429) {
    return 'The robot already has a client connected. Close the Unitree app, or any other tab holding this robot, wait about five seconds and try again.'
  }
  if (status === 504) return 'The robot is mid-transition and did not answer in time. Wait a few seconds and try again.'
  if (status === 403) return 'The robot refused the connection. Check the serial number and the device AES key.'
  return null
}

async function post(url, body, headers, timeoutMs = 8000) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { method: 'POST', body, headers, signal: ctrl.signal })
    const text = await res.text()
    if (!res.ok) throw new Error(explainStatus(res.status) ?? `${url} returned HTTP ${res.status}`)
    return text
  } finally {
    clearTimeout(timer)
  }
}

/** Legacy plaintext flow. */
async function signalOld(ip, offerJson) {
  const text = await post(`http://${ip}:8081/offer`, offerJson, { 'Content-Type': 'application/json' })
  return text
}

/** Encrypted flow: fetch the robot's session public key, wrap a fresh AES key, exchange. */
async function signalNew(ip, offerJson, aes128Key) {
  const notifyText = await post(`http://${ip}:9991/con_notify`, undefined, undefined)
  const decoded = Buffer.from(notifyText, 'base64').toString('utf8')
  const { data1: rawData1, data2 } = JSON.parse(decoded)

  let data1 = rawData1
  if (data2 === 2) data1 = decryptData1Legacy(rawData1)
  else if (data2 === 3) data1 = decryptData1V3(rawData1, aes128Key)

  const publicKeyPem = data1.slice(10, data1.length - 10)
  const pathEnding = calcLocalPathEnding(data1)

  const aesKey = generateAesKey()
  const publicKey = loadPublicKey(publicKeyPem)

  const body = JSON.stringify({
    data1: aesEncrypt(offerJson, aesKey),
    data2: rsaEncrypt(aesKey, publicKey),
  })

  const answerText = await post(`http://${ip}:9991/con_ing_${pathEnding}`, body, {
    'Content-Type': 'application/x-www-form-urlencoded',
  })
  return aesDecrypt(answerText, aesKey)
}

/**
 * Exchange an offer for an answer over the LAN.
 * @param ip robot address
 * @param sdp { sdp, type } from the browser
 * @param token cloud access token, or '' for LAN-only
 * @param aes128Key per-device key, required on firmware >= 1.1.15
 * @param accessPoint true when connected to the robot's own hotspot, which uses
 *        an empty id instead of the station-mode marker
 */
export async function signalRobot(ip, sdp, token = '', aes128Key = '', accessPoint = false) {
  const offerJson = JSON.stringify({
    id: accessPoint ? '' : 'STA_localNetwork',
    sdp: sdp.sdp,
    type: sdp.type,
    token,
  })

  let answerText
  if (await probePort(ip, 9991, 1500)) {
    console.log(`[signaling] ${ip}: con_notify flow (:9991)`)
    answerText = await signalNew(ip, offerJson, aes128Key)
  } else if (await probePort(ip, 8081, 1500)) {
    console.log(`[signaling] ${ip}: legacy offer flow (:8081)`)
    answerText = await signalOld(ip, offerJson)
  } else {
    throw new Error(`No signaling port open on ${ip} (tried 9991 and 8081). Check the robot is powered on and reachable.`)
  }

  const answer = JSON.parse(answerText)
  if (answer.sdp === 'reject') {
    throw new Error('Robot refused the connection - another client (phone app?) already holds the session')
  }
  return { sdp: answer.sdp, type: answer.type }
}

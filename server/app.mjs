// The API half of the backend: signaling proxy, discovery, cloud client, and
// the optional password gate. Shared by two entry points - server/index.mjs
// runs it locally with static files and hot reload, api/index.mjs runs it as a
// serverless function on Vercel so the console works from anywhere without
// hosting anything yourself.
//
// The browser cannot reach the robot's signaling endpoint directly (no CORS
// headers, and newer firmware encrypts the exchange), so this proxy performs
// signaling on its behalf. Media and the data channel still flow browser <->
// robot directly once the answer comes back.

import express from 'express'
import { signalRobot } from './signaling.mjs'
import { discoverRobots, resolveSerial } from './discovery.mjs'
import { cloudLogin, getCloudTurn, signalViaCloud } from './cloud.mjs'
import { installAuth } from './auth.mjs'

/** True when running as a Vercel serverless function, where there is no LAN. */
const SERVERLESS = process.env.VERCEL === '1'

/** Convert Unitree's TURN shape into the browser's RTCIceServer list. */
function toIceServers(turnServer) {
  const ice = []
  if (turnServer?.realm && turnServer?.user && turnServer?.passwd) {
    ice.push({ urls: [turnServer.realm], username: turnServer.user, credential: turnServer.passwd })
    // Google's public STUN, matching the reference client, helps candidate discovery.
    ice.push({ urls: ['stun:stun.l.google.com:19302'] })
  }
  return ice
}

export function createApp() {
  const app = express()
  app.use(express.json({ limit: '4mb' }))

  // Nothing under /api may ever be cached: it is all live state and
  // credentials - session checks, TURN passwords, signaling exchanges. A
  // cached copy of any of it is at best stale and at worst a security hole.
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store')
    next()
  })

  // Optional password gate, for exposing the console beyond the local machine.
  // Set with WEBUI_PASSWORD=... or --password <value>. Registered before the API
  // routes so the gate covers all of them.
  const pwFlag = process.argv.indexOf('--password')
  const password = pwFlag !== -1 ? (process.argv[pwFlag + 1] ?? '') : (process.env.WEBUI_PASSWORD ?? '')
  // A serverless deployment is always internet-facing, so there the gate is
  // mandatory: no password means the API refuses to serve, not fails open.
  const locked = installAuth(app, password, { enforce: SERVERLESS })

  /**
   * Exchange an SDP offer for an answer.
   * Body: { method, sdp, ip?, serial?, token?, aesKey?, region? }
   *   method "ip"     - robot on this network at a known address
   *   method "serial" - robot on this network, found by serial number
   *   method "ap"     - connected to the robot's own hotspot (192.168.12.1)
   *   method "cloud"  - relayed through the Unitree cloud, robot anywhere
   */
  app.post('/api/connect', async (req, res) => {
    const { method = 'ip', ip, serial, token = '', aesKey = '', region = 'global', sdp, turnServer } = req.body ?? {}
    if (!sdp?.sdp || sdp.type !== 'offer') {
      res.status(400).json({ error: 'A valid SDP offer is required' })
      return
    }

    try {
      if (method === 'cloud') {
        if (!serial) throw new Error('Pick a robot from your account first')
        if (!token) throw new Error('Sign in to your Unitree account first')
        // turnServer was handed to the browser earlier so its offer already carries
        // relay candidates; reuse it here rather than fetching a second set.
        const answer = await signalViaCloud({ sn: serial, sdp, token, region, turnServer: turnServer ?? null })
        res.json(answer)
        return
      }

      if (SERVERLESS) {
        throw new Error(
          'This deployment runs in the cloud, away from your network - only the Unitree account method can reach the robot from here',
        )
      }

      let target = ip
      if (method === 'ap') {
        target = '192.168.12.1'
      } else if (method === 'serial') {
        if (!serial) throw new Error('Enter the robot serial number')
        target = await resolveSerial(serial)
        if (!target) throw new Error(`No robot with serial ${serial} answered on this network`)
      }
      if (!target) throw new Error('Enter the robot address')

      const answer = await signalRobot(target, sdp, token, aesKey, method === 'ap')
      res.json({ ...answer, ip: target })
    } catch (err) {
      res.status(502).json({ error: String(err?.message ?? err) })
    }
  })

  // Scan the LAN for robots. Returns [{ ip, sn, name }]
  app.get('/api/discover', async (_req, res) => {
    if (SERVERLESS) {
      // A cloud function has no LAN to scan; answer instantly instead of
      // multicasting into the void for four seconds.
      res.json({ robots: [] })
      return
    }
    try {
      const robots = await discoverRobots(4000)
      res.json({ robots })
    } catch (err) {
      res.status(500).json({ error: String(err?.message ?? err), robots: [] })
    }
  })

  // Is this cloud robot actually sitting on the server's own network? If so
  // the whole relay dance is unnecessary - the client asks here first and
  // connects locally when the robot answers. A cloud deployment has no LAN,
  // so it answers no instantly rather than multicasting into the void.
  app.post('/api/cloud/local-check', async (req, res) => {
    const { serial } = req.body ?? {}
    if (SERVERLESS || !serial) {
      res.json({ ip: null })
      return
    }
    try {
      res.json({ ip: await resolveSerial(serial, 2500) })
    } catch {
      res.json({ ip: null })
    }
  })

  // TURN credentials for a cloud robot, so the browser can build its peer
  // connection with a relay before it makes the offer.
  app.post('/api/cloud/turn', async (req, res) => {
    const { serial, token, region = 'global' } = req.body ?? {}
    if (!serial || !token) {
      res.status(400).json({ error: 'A signed-in account and a robot are required' })
      return
    }
    try {
      const turnServer = await getCloudTurn({ sn: serial, token, region })
      res.json({ turnServer, iceServers: toIceServers(turnServer) })
    } catch (err) {
      res.status(502).json({ error: String(err?.message ?? err) })
    }
  })

  // Sign in to a Unitree account and list the robots bound to it.
  app.post('/api/cloud/login', async (req, res) => {
    const { email, password: pw, region = 'global' } = req.body ?? {}
    if (!email || !pw) {
      res.status(400).json({ error: 'Enter the email and password for your Unitree account' })
      return
    }
    try {
      const result = await cloudLogin({ email, password: pw, region })
      res.json(result)
    } catch (err) {
      res.status(502).json({ error: String(err?.message ?? err) })
    }
  })

  return { app, locked }
}

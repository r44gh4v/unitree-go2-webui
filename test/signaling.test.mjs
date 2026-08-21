// Drive the real signaling code against the mock robot, one flow at a time.
import crypto from 'node:crypto'
import { startMockRobot } from './mockrobot.mjs'
import { signalRobot } from '../server/signaling.mjs'

let pass = 0, fail = 0
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (ok) { pass++; console.log(`  ok   ${name}`) }
  else { fail++; console.log(`  FAIL ${name}\n       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`) }
}

const OFFER = { sdp: 'v=0\r\no=- 1 2 IN IP4 0.0.0.0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n', type: 'offer' }

async function run() {
  // --- new encrypted flow, data2 = 1 (plaintext key material) ---
  {
    const { server, seen, expectedPath } = await startMockRobot({ port: 9991, data2: 1 })
    const answer = await signalRobot('127.0.0.1', OFFER, '')
    check('v1 answer sdp', answer.sdp, 'v=0\r\nMOCK-ANSWER-ENCRYPTED\r\n')
    check('v1 answer type', answer.type, 'answer')
    check('v1 robot received our offer', seen.offer, OFFER.sdp)
    check('v1 station-mode id', seen.id, 'STA_localNetwork')
    check('v1 path ending derived', seen.path, expectedPath)
    server.close()
  }

  // --- access-point variant sends an empty id ---
  {
    const { server, seen } = await startMockRobot({ port: 9991, data2: 1 })
    await signalRobot('127.0.0.1', OFFER, '', '', true)
    check('ap mode uses empty id', seen.id, '')
    server.close()
  }

  // --- data2 = 2: data1 wrapped with the static legacy GCM key ---
  {
    const { server, seen, expectedPath } = await startMockRobot({ port: 9991, data2: 2 })
    const answer = await signalRobot('127.0.0.1', OFFER, '')
    check('v2 answer decrypted', answer.sdp, 'v=0\r\nMOCK-ANSWER-ENCRYPTED\r\n')
    check('v2 path ending', seen.path, expectedPath)
    server.close()
  }

  // --- data2 = 3: per-device key required ---
  {
    const devKey = crypto.randomBytes(16).toString('hex')
    const { server, seen } = await startMockRobot({ port: 9991, data2: 3, aes128Key: devKey })

    let threw = ''
    try { await signalRobot('127.0.0.1', OFFER, '', '') } catch (e) { threw = e.message }
    check('v3 without a key is refused', threw.includes('per-device AES key'), true)

    threw = ''
    try { await signalRobot('127.0.0.1', OFFER, '', crypto.randomBytes(16).toString('hex')) } catch (e) { threw = e.message }
    check('v3 with the wrong key is refused', threw.includes('rejected'), true)

    const answer = await signalRobot('127.0.0.1', OFFER, '', devKey)
    check('v3 with the right key succeeds', answer.sdp, 'v=0\r\nMOCK-ANSWER-ENCRYPTED\r\n')
    check('v3 offer arrived intact', seen.offer, OFFER.sdp)
    server.close()
  }

  // --- legacy plaintext flow on 8081 (9991 closed) ---
  {
    const { server, seen } = await startMockRobot({ port: 8081, flow: 'old' })
    const answer = await signalRobot('127.0.0.1', OFFER, 'tok123')
    check('legacy answer', answer.sdp, 'v=0\r\nMOCK-ANSWER-PLAIN\r\n')
    check('legacy offer intact', seen.offer, OFFER.sdp)
    check('legacy token forwarded', seen.token, 'tok123')
    server.close()
  }

  // --- robot busy ---
  {
    const http = await import('node:http')
    const busy = http.createServer((req, res) => {
      let b = ''
      req.on('data', (d) => (b += d))
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ sdp: 'reject', type: 'answer' }))
      })
    })
    await new Promise((r) => busy.listen(8081, '127.0.0.1', r))
    let threw = ''
    try { await signalRobot('127.0.0.1', OFFER, '') } catch (e) { threw = e.message }
    check('busy robot reported clearly', threw.includes('another client'), true)
    busy.close()
  }

  // --- nothing listening ---
  {
    let threw = ''
    try { await signalRobot('127.0.0.1', OFFER, '') } catch (e) { threw = e.message }
    check('no ports open reported clearly', threw.includes('No signaling port open'), true)
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}

run().catch((e) => { console.error(e); process.exit(1) })

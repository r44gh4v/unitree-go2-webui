// Loopback test for the data-channel protocol.
//
// Two RTCPeerConnections are wired to each other inside the browser. One side
// runs the real Go2Connection; the other plays the robot, answering the
// validation challenge, acknowledging heartbeats, and publishing telemetry.
// This exercises the wire format in the runtime it actually ships in.

import { Go2Connection, encryptValidationKey, unwrapResponse } from '../src/lib/go2'
import { TOPICS, SPORT_CMD, VUI_API } from '../src/lib/constants'
// unwrapResponse is exercised indirectly; keep the import list honest

const out = document.getElementById('out')!
let pass = 0
let fail = 0

function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (ok) pass++
  else fail++
  const line = document.createElement('div')
  line.className = ok ? 'ok' : 'fail'
  line.textContent = ok
    ? `  ok   ${name}`
    : `  FAIL ${name}\n       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`
  out.appendChild(line)
}

interface RobotMsg {
  type?: string
  topic?: string
  data?: unknown
}

/** Records everything the client sent and replies the way the robot would. */
class FakeRobot {
  received: RobotMsg[] = []
  heartbeats = 0
  subscribed = new Set<string>()
  unsubscribed = new Set<string>()
  videoState: string | null = null
  audioState: string | null = null
  challenge = 'aB3xY9'
  validatedWith: string | null = null

  constructor(private channel: RTCDataChannel) {
    channel.onmessage = (ev) => this.onMessage(ev.data)
  }

  send(obj: unknown) {
    if (this.channel.readyState === 'open') this.channel.send(JSON.stringify(obj))
  }

  sendBinary(buf: ArrayBuffer) {
    if (this.channel.readyState === 'open') this.channel.send(buf)
  }

  challengeClient() {
    this.send({ type: 'validation', data: this.challenge })
  }

  private onMessage(raw: string | ArrayBuffer) {
    if (typeof raw !== 'string') return
    const msg = JSON.parse(raw) as RobotMsg
    this.received.push(msg)

    switch (msg.type) {
      case 'validation':
        this.validatedWith = msg.data as string
        this.send({ type: 'validation', data: 'Validation Ok.' })
        break
      case 'heartbeat':
        this.heartbeats++
        break
      case 'subscribe':
        this.subscribed.add(msg.topic!)
        break
      case 'unsubscribe':
        this.unsubscribed.add(msg.topic!)
        break
      case 'vid':
        this.videoState = msg.data as string
        break
      case 'aud':
        this.audioState = msg.data as string
        break
      case 'req': {
        // The camera answers over the binary channel instead, so the test
        // drives those frames by hand rather than replying here.
        if (msg.topic === 'rt/api/videohub/request') break
        // echo the request id back the way the robot does, with a payload
        const d = msg.data as { header: { identity: { id: number; api_id: number } }; parameter: string }
        const id = d.header.identity.id
        const apiId = d.header.identity.api_id
        let payload = ''
        if (apiId === VUI_API.GET_BRIGHTNESS) payload = JSON.stringify({ brightness: 7 })
        else if (apiId === SPORT_CMD.GetBodyHeight) payload = JSON.stringify({ data: 0.32 })
        else payload = JSON.stringify({ echoed: apiId, parameter: d.parameter })
        this.send({
          type: 'res',
          topic: msg.topic,
          data: { header: { identity: { id, api_id: apiId }, status: { code: 0 } }, data: payload },
        })
        break
      }
      case 'rtc_inner_req': {
        const d = msg.data as { uuid?: number; req_type?: string }
        this.send({ type: 'rtc_inner_req', info: { uuid: d.uuid, req_type: d.req_type, execution: 'ok' } })
        break
      }
    }
  }

  /** Publish a plain telemetry message on a topic. */
  publish(topic: string, data: unknown) {
    this.send({ type: 'msg', topic, data })
  }

  /** Frame a binary message the way the robot does: uint16 length, JSON, payload. */
  publishBinary(topic: string, header: unknown, payload: Uint8Array, lidarVariant: boolean) {
    const json = new TextEncoder().encode(JSON.stringify({ type: 'msg', topic, data: header }))
    if (lidarVariant) {
      const buf = new ArrayBuffer(4 + 8 + json.length + payload.length)
      const view = new DataView(buf)
      view.setUint16(0, 2, true)
      view.setUint16(2, 0, true)
      view.setUint32(4, json.length, true)
      new Uint8Array(buf).set(json, 12)
      new Uint8Array(buf).set(payload, 12 + json.length)
      this.sendBinary(buf)
    } else {
      const buf = new ArrayBuffer(4 + json.length + payload.length)
      const view = new DataView(buf)
      view.setUint16(0, json.length, true)
      new Uint8Array(buf).set(json, 4)
      new Uint8Array(buf).set(payload, 4 + json.length)
      this.sendBinary(buf)
    }
  }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function waitFor(predicate: () => boolean, timeoutMs = 4000, label = 'condition') {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return true
    await wait(25)
  }
  throw new Error(`timed out waiting for ${label}`)
}

async function run() {
  const conn = new Go2Connection()

  // Wire two peers together, bypassing the signaling server: this test is about
  // the data channel, not the handshake (which signaltest.mjs covers).
  const clientPc = new RTCPeerConnection()
  const robotPc = new RTCPeerConnection()
  // Rewrite mDNS ".local" host candidates to loopback so the test runs even
  // where no mDNS responder is available, so this loopback test runs anywhere.
  const forward = (to: RTCPeerConnection) => (e: RTCPeerConnectionIceEvent) => {
    if (!e.candidate) return
    let text = e.candidate.candidate
    if (/\.local\b/.test(text)) text = text.replace(/[0-9a-f-]+\.local/i, '127.0.0.1')
    void to.addIceCandidate(new RTCIceCandidate({ ...e.candidate.toJSON(), candidate: text })).catch(() => undefined)
  }
  clientPc.onicecandidate = forward(robotPc)
  robotPc.onicecandidate = forward(clientPc)

  let robot!: FakeRobot
  const robotReady = new Promise<void>((resolve) => {
    robotPc.ondatachannel = (ev) => {
      robot = new FakeRobot(ev.channel)
      ev.channel.onopen = () => resolve()
      if (ev.channel.readyState === 'open') resolve()
    }
  })

  // Hand Go2Connection the client peer, then negotiate manually.
  const states: string[] = []
  conn.addEventListener('state', (e) => states.push((e as CustomEvent).detail.state))

  // reach into the connection the same way connect() would, minus the fetch
  ;(conn as unknown as { pc: RTCPeerConnection }).pc = clientPc
  const dc = clientPc.createDataChannel('data')
  dc.binaryType = 'arraybuffer'
  ;(conn as unknown as { dc: RTCDataChannel }).dc = dc
  dc.onmessage = (ev) => (conn as unknown as { handleMessage: (d: unknown) => void }).handleMessage(ev.data)

  const offer = await clientPc.createOffer()
  await clientPc.setLocalDescription(offer)
  await robotPc.setRemoteDescription(offer)
  const answer = await robotPc.createAnswer()
  await robotPc.setLocalDescription(answer)
  await clientPc.setRemoteDescription(answer)

  await new Promise<void>((resolve) => {
    if (dc.readyState === 'open') resolve()
    else dc.onopen = () => resolve()
  })
  await robotReady

  check('data channel label', dc.label, 'data')

  // --- validation ---
  robot.challengeClient()
  await waitFor(() => conn.state === 'connected', 4000, 'validation')
  check('validation answer', robot.validatedWith, encryptValidationKey('aB3xY9'))
  check('state after validation', conn.state, 'connected')

  // --- heartbeat ---
  await waitFor(() => robot.heartbeats >= 1, 3000, 'first heartbeat')
  const hb = robot.received.find((m) => m.type === 'heartbeat')!
  const hbData = hb.data as { timeInStr: string; timeInNum: number }
  check('heartbeat has a formatted time', /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(hbData.timeInStr), true)
  check('heartbeat has unix seconds', Math.abs(hbData.timeInNum - Math.floor(Date.now() / 1000)) < 5, true)

  // --- request / response matching ---
  const res = await conn.request(TOPICS.VUI, VUI_API.GET_BRIGHTNESS)
  check('response unwraps', unwrapResponse<{ brightness: number }>(res).brightness, 7)

  const reqMsg = robot.received.filter((m) => m.type === 'req').pop()!
  const reqData = reqMsg.data as { header: { identity: { api_id: number } }; parameter: string }
  check('request type is req', reqMsg.type, 'req')
  check('request topic', reqMsg.topic, TOPICS.VUI)
  check('request api id', reqData.header.identity.api_id, VUI_API.GET_BRIGHTNESS)
  check('parameter empty when absent', reqData.parameter, '')

  // object parameters must arrive JSON-encoded as a string
  await conn.request(TOPICS.SPORT_MOD, SPORT_CMD.Move, { x: 0.4, y: 0, z: 0.1 })
  const moveReq = robot.received.filter((m) => m.type === 'req').pop()!
  const moveData = moveReq.data as { parameter: string }
  check('object parameter is a string', typeof moveData.parameter, 'string')
  check('object parameter content', JSON.parse(moveData.parameter), { x: 0.4, y: 0, z: 0.1 })

  // two requests in flight resolve to their own replies
  const [a, b] = await Promise.all([
    conn.request(TOPICS.SPORT_MOD, 4001),
    conn.request(TOPICS.SPORT_MOD, 4002),
  ])
  check('concurrent request A', unwrapResponse<{ echoed: number }>(a).echoed, 4001)
  check('concurrent request B', unwrapResponse<{ echoed: number }>(b).echoed, 4002)

  // --- timeout is reported and does not leak ---
  robot.received.length = 0
  let timedOut = ''
  const origSend = (robot as unknown as { send: (o: unknown) => void }).send
  ;(robot as unknown as { send: (o: unknown) => void }).send = function (o: { type?: string }) {
    if (o?.type === 'res') return // swallow this one reply
    origSend.call(this, o)
  }
  try {
    await conn.request(TOPICS.SPORT_MOD, 4003, undefined, 300)
  } catch (e) {
    timedOut = (e as Error).message
  }
  ;(robot as unknown as { send: (o: unknown) => void }).send = origSend
  check('timeout reports the api id', timedOut.includes('4003'), true)

  // --- no-reply send carries the noreply policy ---
  conn.sendNoReply(TOPICS.SPORT_MOD, SPORT_CMD.Move, { x: 1, y: 0, z: 0 })
  await wait(60)
  const noReply = robot.received.filter((m) => m.type === 'msg').pop()!
  const nrData = noReply.data as { header: { policy: { noreply: boolean } }; binary: unknown[] }
  check('no-reply type is msg', noReply.type, 'msg')
  check('no-reply policy', nrData.header.policy.noreply, true)
  check('no-reply carries empty binary', nrData.binary, [])

  // --- subscribe / unsubscribe and telemetry delivery ---
  const seen: unknown[] = []
  const unsub = conn.subscribe(TOPICS.LOW_STATE, (d) => seen.push(d))
  await waitFor(() => robot.subscribed.has(TOPICS.LOW_STATE), 2000, 'subscribe')
  robot.publish(TOPICS.LOW_STATE, { bms_state: { soc: 83 }, power_v: 28.4 })
  await waitFor(() => seen.length > 0, 2000, 'telemetry')
  check('telemetry payload', (seen[0] as { bms_state: { soc: number } }).bms_state.soc, 83)

  unsub()
  await waitFor(() => robot.unsubscribed.has(TOPICS.LOW_STATE), 2000, 'unsubscribe')
  check('unsubscribed on last listener', robot.unsubscribed.has(TOPICS.LOW_STATE), true)

  // two listeners on one topic subscribe once and unsubscribe once
  robot.subscribed.clear()
  robot.unsubscribed.clear()
  const u1 = conn.subscribe(TOPICS.SPORT_MOD_STATE, () => {})
  const u2 = conn.subscribe(TOPICS.SPORT_MOD_STATE, () => {})
  await wait(80)
  check('one subscribe for two listeners', robot.received.filter((m) => m.type === 'subscribe' && m.topic === TOPICS.SPORT_MOD_STATE).length, 1)
  u1()
  await wait(60)
  check('no unsubscribe while a listener remains', robot.unsubscribed.has(TOPICS.SPORT_MOD_STATE), false)
  u2()
  await waitFor(() => robot.unsubscribed.has(TOPICS.SPORT_MOD_STATE), 2000, 'final unsubscribe')
  check('unsubscribe after the last listener', robot.unsubscribed.has(TOPICS.SPORT_MOD_STATE), true)

  // --- video and audio toggles ---
  conn.setVideo(true)
  conn.setAudio(true)
  await wait(60)
  check('video on', robot.videoState, 'on')
  check('audio on', robot.audioState, 'on')
  conn.setVideo(false)
  await wait(60)
  check('video off', robot.videoState, 'off')

  // --- traffic saving handshake ---
  const ts = await conn.disableTrafficSaving(true)
  check('traffic saving acknowledged', (ts.info as { execution: string }).execution, 'ok')

  // --- binary frames: classic framing ---
  const binSeen: unknown[] = []
  const ub = conn.subscribe('rt/test/binary', (d) => binSeen.push(d))
  await wait(60)
  robot.publishBinary('rt/test/binary', { note: 'hello' }, new Uint8Array([1, 2, 3, 4]), false)
  await waitFor(() => binSeen.length > 0, 2000, 'binary frame')
  const binPayload = (binSeen[0] as { note: string; binary: ArrayBuffer })
  check('binary header parsed', binPayload.note, 'hello')
  check('binary payload length', binPayload.binary.byteLength, 4)
  ub()

  // --- binary frames: lidar variant, decoded into points ---
  const voxelSeen: unknown[] = []
  const uv = conn.subscribe(TOPICS.ULIDAR_ARRAY, (d) => voxelSeen.push(d))
  await wait(60)
  // one occupied voxel at grid (0,0,0); LZ4: 16 literals then a long RLE run
  const srcSize = 0x800
  const raw = new Uint8Array(srcSize)
  raw[0] = 0b10000000
  // encode `raw` as an LZ4 block: 1 literal (0x80) then zeros via overlapping match
  // two literals are emitted first, so the run has to cover the rest
  const matchLen = srcSize - 2 - 4 // stored value, before the +4 minimum
  const extra: number[] = []
  let ml = matchLen
  if (ml >= 15) {
    let rest = ml - 15
    while (rest >= 255) {
      extra.push(255)
      rest -= 255
    }
    extra.push(rest)
    ml = 15
  }
  const block = new Uint8Array([
    (2 << 4) | ml, // 2 literals, match length nibble
    0b10000000, 0x00, // literals: the set byte, then one zero to seed the run
    0x01, 0x00, // offset 1
    ...extra,
  ])
  robot.publishBinary(
    TOPICS.ULIDAR_ARRAY,
    { origin: [1, 2, 3], resolution: 0.05, width: [128, 128, 1], src_size: srcSize },
    block,
    true,
  )
  await waitFor(() => voxelSeen.length > 0, 3000, 'voxel frame')
  const cloud = voxelSeen[0] as { count: number; positions: Float32Array; resolution: number }
  check('voxel decoded one point', cloud.count, 1)
  check('voxel position applies origin', Array.from(cloud.positions).map((v) => +v.toFixed(3)), [1, 2, 3])
  check('voxel resolution passed through', cloud.resolution, 0.05)
  uv()

  // --- a chunked binary reply reassembles into one payload (camera stills) ---
  {
    const photo = conn.capturePhoto(4000)
    await wait(80)
    const photoReq = robot.received.filter((m) => m.type === 'req').pop()!
    const photoId = (photoReq.data as { header: { identity: { id: number } } }).header.identity.id
    check('photo request topic', photoReq.topic, TOPICS.FRONT_PHOTO_REQ)

    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 0xff, 0xd9])
    const parts = [jpeg.subarray(0, 5), jpeg.subarray(5, 9), jpeg.subarray(9)]
    parts.forEach((part, i) => {
      robot.publishBinary(
        'rt/api/videohub/response',
        {
          header: { identity: { id: photoId, api_id: 1001 }, status: { code: 0 } },
          content_info: { enable_chunking: true, chunk_index: i + 1, total_chunk_num: parts.length },
        },
        part,
        false,
      )
    })

    const blob = await photo
    check('photo reassembled size', blob.size, jpeg.length)
    const bytes = new Uint8Array(await blob.arrayBuffer())
    check('photo bytes in order', Array.from(bytes), Array.from(jpeg))
    check('photo mime type', blob.type, 'image/jpeg')
  }

  // --- robot faults surface ---
  const faults: unknown[] = []
  conn.addEventListener('robot-error', (e) => faults.push((e as CustomEvent).detail))
  robot.send({ type: 'add_error', data: [1700000000, 300, 4] })
  await waitFor(() => faults.length > 0, 2000, 'fault')
  check('fault type', (faults[0] as { type: string }).type, 'add_error')

  // --- re-validation on demand ---
  robot.validatedWith = null
  robot.send({ type: 'err', info: 'Validation Needed.' })
  await waitFor(() => robot.validatedWith !== null, 2000, 're-validation')
  check('re-sends the key when asked', robot.validatedWith, encryptValidationKey('aB3xY9'))

  // --- disconnect tears everything down ---
  conn.disconnect()
  await wait(120)
  check('state after disconnect', conn.state, 'closed')
  const beats = robot.heartbeats
  await wait(2200)
  check('heartbeat stops after disconnect', robot.heartbeats, beats)

  robotPc.close()

  const summary = document.createElement('div')
  summary.style.marginTop = '12px'
  summary.className = fail ? 'fail' : 'ok'
  summary.textContent = `${pass} passed, ${fail} failed`
  summary.id = 'summary'
  out.appendChild(summary)
  ;(window as unknown as { RESULT: string }).RESULT = fail ? 'FAILED' : 'PASSED'
}

run().catch((e) => {
  const line = document.createElement('div')
  line.className = 'fail'
  line.textContent = `harness error: ${e.message}\n${e.stack}`
  out.appendChild(line)
  const summary = document.createElement('div')
  summary.id = 'summary'
  summary.className = 'fail'
  summary.textContent = `${pass} passed, ${fail} failed - harness error`
  out.appendChild(summary)
  ;(window as unknown as { RESULT: string }).RESULT = 'FAILED'
})

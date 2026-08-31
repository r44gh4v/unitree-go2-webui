// Go2 WebRTC link: peer setup, validation handshake, heartbeat, pub/sub,
// api requests, binary frame parsing. Signaling goes through the local proxy at
// /api/connect; everything after that is browser <-> robot direct.
//
// Wire format transcribed from legion1581/unitree_webrtc_connect. Notable
// details: requests use type "req" (not "request"), `parameter` is always a
// JSON *string*, and responses are matched purely on header.identity.id.

import { md5 } from 'js-md5'
import { API_STATUS_CODES, DATA_CHANNEL_TYPE, SPORT_CMD, TOPICS } from './constants'
import { lastServerInfo } from './serverInfo'
import { decodeVoxelMesh, type VoxelMesh } from './voxel'
import { ChunkAssembler, readFrame, type ChunkInfo } from './frames'
import { nextRequestId } from './correlation'
import { parseMaybeJson } from './wireJson'
import { exchangeOffer, planRoute, type ConnectOptions, type Route, type SignallingDeps } from './signalling'
import { FileTransfer } from './fileTransfer'

export type { ConnectOptions } from './signalling'

export type ConnState = 'idle' | 'connecting' | 'validating' | 'connected' | 'error' | 'closed'

export interface TrafficEntry {
  dir: 'in' | 'out' | 'sys'
  text: string
  ts: number
}

export interface ApiStatus {
  code: number
}

export interface ApiResponseData {
  header?: { identity?: { id: number; api_id: number }; status?: ApiStatus }
  /** JSON-encoded payload string; use unwrapResponse() to get the parsed value */
  data?: string
  [k: string]: unknown
}

export interface ApiResponse {
  type?: string
  topic?: string
  data?: ApiResponseData
  /** string on `err` frames ("Validation Needed."), an object on rtc_inner_req */
  info?: string | Record<string, unknown>
}

/** Human-readable form of a robot status code. */
export function describeStatus(code: number): string {
  return API_STATUS_CODES[code] ? `${API_STATUS_CODES[code]} (${code})` : `Robot refused the command (status ${code})`
}

/** Parsed form of a request/response pair. Throws if the robot reported failure. */
export function unwrapResponse<T = unknown>(res: ApiResponse): T {
  const code = res.data?.header?.status?.code
  if (code !== undefined && code !== 0) throw new Error(describeStatus(code))
  const raw = res.data?.data
  // Absence stays undefined here rather than null: callers of this one check
  // for a missing reply, and the two have different meanings on an api call.
  if (raw === undefined || raw === '') return undefined as T
  return parseMaybeJson<T>(raw) as T
}

const HEARTBEAT_MS = 2000
const REQUEST_TIMEOUT_MS = 8000
/**
 * How long the peer connection may sit in 'disconnected' before it is called
 * lost. ICE consent checks lapse briefly whenever wifi wobbles, and more so
 * on a relayed path, and the connection recovers on its own most of the
 * time. Failing on the first blip is what made the link feel fragile.
 */
const DISCONNECT_GRACE_MS = 8000
/**
 * The robot publishes continuously, so an open channel carrying nothing at
 * all for this long means it has gone without closing anything. Without the
 * check the console keeps showing healthy numbers that stopped updating.
 */
const SILENCE_MS = 12000
/**
 * How long to let a parting StopMove reach the wire before the transport is
 * torn down under it. Closing the peer connection immediately after a send
 * can take the send with it.
 */
const SAFE_FLUSH_MS = 250
/** How long the robot gets to open the data channel and pass validation. */
const HANDSHAKE_TIMEOUT_MS = 15000

function hexToBase64(hex: string): string {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  let bin = ''
  bytes.forEach((b) => (bin += String.fromCharCode(b)))
  return btoa(bin)
}

/** Validation answer the robot expects: base64(md5_bytes("UnitreeGo2_" + key)). */
export function encryptValidationKey(key: string): string {
  return hexToBase64(md5(`UnitreeGo2_${key}`))
}

function formatRobotTime(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

interface Pending {
  resolve: (v: ApiResponse) => void
  reject: (e: Error) => void
  timer: ReturnType<typeof setTimeout>
}

/** Topics whose payloads arrive many times a second - kept out of the console log. */
const NOISY_TOPICS = new Set<string>([
  TOPICS.LOW_STATE,
  TOPICS.LF_SPORT_MOD_STATE,
  TOPICS.SPORT_MOD_STATE,
  TOPICS.ULIDAR_ARRAY,
  TOPICS.ULIDAR,
  TOPICS.ROBOTODOM,
])

export class Go2Connection extends EventTarget {
  pc: RTCPeerConnection | null = null
  dc: RTCDataChannel | null = null
  state: ConnState = 'idle'
  mediaStream = new MediaStream()
  ip = ''
  lastValidationKey = ''

  private hbTimer: ReturnType<typeof setInterval> | null = null
  /** Fails the attempt if the robot never finishes the handshake. */
  private connectTimer: ReturnType<typeof setTimeout> | null = null
  /** Runs while the peer connection is interrupted but may still recover. */
  private dropTimer: ReturnType<typeof setTimeout> | null = null
  /** When the robot last said anything at all, for the silence watchdog. */
  private lastInboundAt = 0
  private pending = new Map<number, Pending>()
  private subs = new Map<string, Set<(data: unknown, message: ApiResponse) => void>>()
  private live = new Set<string>()
  /** Reassembles payloads that arrive split across frames. */
  private chunks = new ChunkAssembler()
  /**
   * Moving whole files - the SLAM map out and back. Built with a channel rather
   * than this object, so it can be exercised without a peer connection.
   */
  readonly files: FileTransfer

  private msgCount = 0
  private byteCount = 0
  /** Bumped by every connect and disconnect so a superseded attempt can bail. */
  private generation = 0

  constructor() {
    super()
    // Arrow functions so the channel closes over this connection lexically:
    // the transfer module never holds a reference to the connection itself,
    // only to the four things it actually needs.
    this.files = new FileTransfer({
      isOpen: () => this.isOpen,
      send: (data) => this.sendRaw({ type: DATA_CHANNEL_TYPE.RTC_INNER_REQ, topic: '', data }, true),
      note: (text) => this.traffic('sys', text),
      nextId: () => String(nextRequestId()),
    })
  }

  private emit(name: string, detail?: unknown) {
    this.dispatchEvent(new CustomEvent(name, { detail }))
  }

  private setState(s: ConnState, err?: string) {
    this.state = s
    this.emit('state', { state: s, error: err })
  }

  private traffic(dir: TrafficEntry['dir'], text: string) {
    this.emit('traffic', { dir, text, ts: Date.now() } satisfies TrafficEntry)
  }

  get stats() {
    return { messages: this.msgCount, bytes: this.byteCount, topics: this.live.size }
  }

  // ---- lifecycle ----

  async connect(opts: ConnectOptions): Promise<void> {
    if (this.pc) this.disconnect()
    const gen = ++this.generation
    /** True once a later connect or a disconnect has superseded this attempt. */
    const stale = () => this.generation !== gen
    let method = opts.method ?? 'ip'
    let targetIp = opts.ip ?? ''
    this.msgCount = 0
    this.byteCount = 0
    this.setState('connecting')

    // How to reach this robot, and what the peer connection will need, is
    // decided before there is a peer connection - the ICE configuration has to
    // be in place before the offer. See lib/signalling.ts.
    const deps: SignallingDeps = { fetch: (...a) => fetch(...a), serverHasLan: lastServerInfo()?.serverless !== true }
    let route: Route
    try {
      route = await planRoute(opts, deps)
    } catch (e) {
      if (stale()) throw e
      this.setState('error', (e as Error).message)
      throw e
    }
    if (stale()) return
    route.notes.forEach((n) => this.traffic('sys', n))
    this.ip = route.ip

    const pc = new RTCPeerConnection({ iceServers: route.iceServers })
    this.pc = pc
    pc.addTransceiver('video', { direction: 'recvonly' })
    pc.addTransceiver('audio', { direction: 'recvonly' })

    pc.ontrack = (ev) => {
      this.mediaStream.addTrack(ev.track)
      this.emit('track', { kind: ev.track.kind, stream: this.mediaStream })
    }
    pc.onconnectionstatechange = () => {
      this.traffic('sys', `peer connection: ${pc.connectionState}`)
      if (pc.connectionState === 'connected') {
        // Recovered on its own, which is the common case.
        this.clearDropTimer()
        return
      }
      if (pc.connectionState === 'failed') {
        this.clearDropTimer()
        this.setState('error', 'peer connection failed')
        return
      }
      if (pc.connectionState === 'disconnected' && this.state === 'connected' && !this.dropTimer) {
        // Sent while there may still be a path. If the link comes back the
        // robot has merely stopped, which is recoverable; if it does not,
        // this was the last chance to say anything at all.
        this.makeSafe('link interrupted')
        this.traffic('sys', `link interrupted - giving it ${DISCONNECT_GRACE_MS}ms to come back`)
        this.dropTimer = setTimeout(() => {
          this.dropTimer = null
          if (this.state !== 'connected' || pc.connectionState === 'connected') return
          this.setState('error', 'peer connection lost')
        }, DISCONNECT_GRACE_MS)
      }
    }

    // Ordered and reliable are the spec defaults, but they are stated here
    // because the protocol leans on them: the lidar switch is level-based,
    // so a reordered ON after an OFF would leave the sensor turning.
    const dc = pc.createDataChannel('data', { ordered: true })
    this.dc = dc
    dc.binaryType = 'arraybuffer'
    dc.onopen = () => {
      this.traffic('sys', 'data channel open, waiting for validation challenge')
      this.setState('validating')
    }
    dc.onclose = () => {
      this.traffic('sys', 'data channel closed')
      if (this.state === 'connected' || this.state === 'validating') this.setState('closed')
    }
    dc.onmessage = (ev) => this.handleMessage(ev.data)

    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    // Relay candidates take longer to gather than host ones, so give cloud more time.
    await this.waitIceGathering(pc, route.method === 'cloud' ? 6000 : 2500)
    if (stale()) {
      pc.close()
      return
    }

    let exchanged
    try {
      exchanged = await exchangeOffer(
        { sdp: pc.localDescription!.sdp, type: pc.localDescription!.type },
        route,
        opts,
        deps,
      )
    } catch (e) {
      const msg = (e as Error).message
      // A superseded attempt must not report its failure over a live session.
      if (stale()) throw e
      // The direct attempt was an optimisation; its failure is not the
      // operator's problem. Try the same connect through the relay first.
      if (route.viaShortcut) {
        pc.close()
        this.traffic('sys', `direct connect failed (${msg}) - retrying through the cloud relay`)
        return this.connect({ ...opts, route: 'relay' })
      }
      this.setState('error', msg)
      throw e
    }
    if (stale()) {
      pc.close()
      return
    }
    if (exchanged.ip) this.ip = exchanged.ip
    await pc.setRemoteDescription(new RTCSessionDescription(exchanged.answer))
    this.traffic('sys', `SDP answer applied (${route.method}${this.ip ? ` · ${this.ip}` : ''})`)

    // Signalling succeeding only means the robot took the offer. If the data
    // channel never opens or validation never comes back, nothing else here
    // would ever fire and the panel would sit on "Connecting" forever.
    this.clearConnectTimer()
    this.connectTimer = setTimeout(() => {
      if (this.generation !== gen) return
      if (this.state === 'connected') return
      const why =
        this.state === 'validating'
          ? 'The robot accepted the link but never finished the handshake. On firmware 1.1.15 and newer this usually means the device key is missing or wrong.'
          : 'The robot answered but the data channel never opened. It may already have another client connected.'
      this.traffic('sys', `handshake timed out after ${HANDSHAKE_TIMEOUT_MS}ms`)
      this.setState('error', why)
      pc.close()
    }, HANDSHAKE_TIMEOUT_MS)
  }

  private clearDropTimer() {
    if (this.dropTimer) clearTimeout(this.dropTimer)
    this.dropTimer = null
  }

  private clearConnectTimer() {
    if (this.connectTimer) clearTimeout(this.connectTimer)
    this.connectTimer = null
  }

  private waitIceGathering(pc: RTCPeerConnection, timeoutMs: number): Promise<void> {
    if (pc.iceGatheringState === 'complete') return Promise.resolve()
    return new Promise((resolve) => {
      const finish = () => {
        pc.removeEventListener('icegatheringstatechange', check)
        clearTimeout(t)
        resolve()
      }
      const check = () => {
        if (pc.iceGatheringState === 'complete') finish()
      }
      const t = setTimeout(finish, timeoutMs)
      pc.addEventListener('icegatheringstatechange', check)
    })
  }

  /**
   * Leave the robot somewhere it can be left alone.
   *
   * Locomotion looks after itself: the robot stops walking when velocity
   * commands stop arriving. A mode does not. A robot put into a handstand or
   * a gait from here stays in it after the console is gone, with nothing on
   * the robot to bring it out, and that is the state that is unsafe to walk
   * away from. StopMove halts locomotion and drops the mode with it.
   *
   * Fire-and-forget by necessity - this runs while the link is going or
   * already gone, so there is nobody left to wait for a reply from, and a
   * best-effort send that may not arrive still beats not trying.
   */
  makeSafe(why: string) {
    if (!this.isOpen) return false
    this.traffic('sys', `${why} - sending StopMove so the robot is not left in a mode`)
    this.sendNoReply(TOPICS.SPORT_MOD, SPORT_CMD.StopMove)
    return true
  }
  disconnect() {
    // Hanging up is the one moment the console knows the link is about to go
    // while it can still use it, so it is the best chance to leave the robot
    // in a state nobody has to come back to.
    const parting = this.makeSafe('closing the link')
    // Invalidate any connect still in flight so it cannot revive this session.
    this.generation++
    this.clearConnectTimer()
    this.clearDropTimer()
    if (this.hbTimer) clearInterval(this.hbTimer)
    this.hbTimer = null
    this.pending.forEach((p) => {
      clearTimeout(p.timer)
      p.reject(new Error('Disconnected'))
    })
    this.pending.clear()
    this.files.abandon('Disconnected')
    this.live.clear()
    this.chunks.clear()
    // Handed to locals first: the parting StopMove above is already queued on
    // this channel, and closing the transport now would discard it.
    const dc = this.dc
    const pc = this.pc
    this.dc = null
    this.pc = null
    const shut = () => {
      try {
        dc?.close()
        pc?.close()
      } catch {
        /* already torn down */
      }
    }
    if (parting) setTimeout(shut, SAFE_FLUSH_MS)
    else shut()
    this.mediaStream = new MediaStream()
    this.setState('closed')
  }

  // ---- raw send ----

  private sendRaw(obj: Record<string, unknown>, quiet = false) {
    if (!this.dc || this.dc.readyState !== 'open') return false
    const text = JSON.stringify(obj)
    this.dc.send(text)
    if (!quiet) this.traffic('out', text)
    return true
  }

  get isOpen() {
    return this.dc?.readyState === 'open'
  }

  // ---- inbound ----

  private handleMessage(raw: string | ArrayBuffer) {
    this.msgCount++
    this.lastInboundAt = Date.now()
    if (raw instanceof ArrayBuffer) {
      this.byteCount += raw.byteLength
      this.handleBinary(raw)
      return
    }
    this.byteCount += raw.length
    let msg: ApiResponse
    try {
      msg = JSON.parse(raw)
    } catch {
      this.traffic('in', `<unparseable frame, ${raw.length} bytes>`)
      return
    }

    const topic = msg.topic ?? ''
    const info = typeof msg.info === 'object' ? (msg.info as Record<string, unknown>) : undefined
    // File-transfer frames (the SLAM map) arrive as a burst of large chunks;
    // keep them out of the console log or they drown everything else.
    const isFileChunk = msg.type === DATA_CHANNEL_TYPE.RTC_INNER_REQ && info?.req_type === 'request_static_file'
    const isUploadAck = msg.type === DATA_CHANNEL_TYPE.RTC_INNER_REQ && info?.req_type === 'push_static_file'
    if (msg.type !== DATA_CHANNEL_TYPE.HEARTBEAT && !NOISY_TOPICS.has(topic) && !isFileChunk && !isUploadAck) {
      this.traffic('in', raw.length > 900 ? `${raw.slice(0, 900)}…` : raw)
    }

    switch (msg.type) {
      case DATA_CHANNEL_TYPE.VALIDATION:
        this.onValidation(msg)
        break
      case DATA_CHANNEL_TYPE.ERR:
        // {"type":"err","info":"Validation Needed."} means re-send the key
        if (msg.info === 'Validation Needed.') {
          this.sendRaw({ type: DATA_CHANNEL_TYPE.VALIDATION, topic: '', data: encryptValidationKey(this.lastValidationKey) })
        } else {
          this.emit('robot-error', { type: msg.type, data: msg.info ?? msg.data })
        }
        break
      case DATA_CHANNEL_TYPE.ERRORS:
      case DATA_CHANNEL_TYPE.ADD_ERROR:
      case DATA_CHANNEL_TYPE.RM_ERROR:
        this.emit('robot-error', { type: msg.type, data: msg.data })
        break
      case DATA_CHANNEL_TYPE.HEARTBEAT:
        break
      case DATA_CHANNEL_TYPE.RTC_INNER_REQ:
        if (info?.req_type === 'rtt_probe_send_from_mechine') {
          // The robot measures link latency with these; echo the payload back
          // unchanged or the firmware thinks the connection is unhealthy.
          this.sendRaw({ type: DATA_CHANNEL_TYPE.RTC_INNER_REQ, topic: '', data: info }, true)
        } else if ((isFileChunk || isUploadAck) && info && this.files.handle(info)) {
          /* claimed by a transfer in flight */
        } else {
          this.resolvePending(msg)
          this.emit('inner-req', msg)
        }
        break
      default:
        this.resolvePending(msg)
        if (topic) this.dispatchTopic(topic, msg.data, msg)
    }
  }

  /**
   * Route one binary frame: lidar voxels get decoded, anything else is either
   * the answer to a pending request or a topic payload. The byte layouts and
   * their reassembly live in lib/frames.ts.
   */
  private handleBinary(buf: ArrayBuffer) {
    const frame = readFrame(buf)
    if (!frame) {
      this.traffic('sys', `discarded a binary frame of ${buf.byteLength} bytes that did not parse`)
      return
    }
    const header = frame.header as ApiResponse
    const topic = header.topic ?? ''

    // A large reply - a camera still, a map file - arrives split across frames.
    const key = header.data?.header?.identity?.id ?? topic
    const payload = this.chunks.accept(key, (header.data as { content_info?: ChunkInfo })?.content_info, frame.payload)
    if (payload === null) return

    if (topic.includes('utlidar') && header.data) {
      const meta = header.data as unknown as {
        origin: number[]
        resolution: number
        width: number[]
        src_size: number
      }
      try {
        const mesh = decodeVoxelMesh(new Uint8Array(payload), meta)
        this.dispatchTopic(topic, mesh, header)
        this.emit('voxel', mesh)
      } catch (e) {
        this.traffic('sys', `lidar decode failed: ${String((e as Error).message)}`)
      }
      return
    }

    // A binary reply can also be the answer to a pending request, which is how
    // a camera still comes back.
    const id = header.data?.header?.identity?.id
    if (typeof id === 'number' && this.pending.has(id)) {
      const p = this.pending.get(id)!
      this.pending.delete(id)
      clearTimeout(p.timer)
      p.resolve({ ...header, data: { ...header.data, binary: payload } })
    }
    if (topic) this.dispatchTopic(topic, { ...(header.data as object), binary: payload }, header)
  }

  /**
   * Report which route the media actually took. Even when signaling had to go
   * through the cloud, ICE prefers a direct pair when both ends share a
   * network - this makes the outcome visible instead of guessed at.
   */
  private async reportMediaPath() {
    const pc = this.pc
    if (!pc) return
    try {
      const stats = await pc.getStats()
      let pair: { localCandidateId?: string; remoteCandidateId?: string } | undefined
      stats.forEach((s) => {
        if (s.type === 'transport' && s.selectedCandidatePairId) pair = stats.get(s.selectedCandidatePairId)
      })
      if (!pair) {
        stats.forEach((s) => {
          if (s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded') pair = s
        })
      }
      if (!pair?.localCandidateId || !pair.remoteCandidateId) return
      const local = stats.get(pair.localCandidateId) as { candidateType?: string } | undefined
      const remote = stats.get(pair.remoteCandidateId) as { candidateType?: string } | undefined
      const types = [local?.candidateType, remote?.candidateType]
      const text = types.includes('relay')
        ? 'media path: relayed through the cloud (TURN)'
        : types.every((t) => t === 'host')
          ? 'media path: direct on this network'
          : 'media path: direct peer-to-peer across networks'
      this.traffic('sys', text)
    } catch {
      /* stats are best-effort diagnostics */
    }
  }

  private onValidation(msg: ApiResponse) {
    const data = msg.data as unknown as string
    if (data === 'Validation Ok.') {
      this.traffic('sys', 'validation accepted - link established')
      this.clearConnectTimer()
      this.setState('connected')
      this.startHeartbeat()
      this.emit('validated')
      // Give ICE a moment to settle on its final pair before reading it.
      setTimeout(() => void this.reportMediaPath(), 1500)
      // (re)subscribe everything registered while disconnected
      this.live.clear()
      this.subs.forEach((_cbs, topic) => this.sendSubscribe(topic))
    } else {
      this.lastValidationKey = data
      this.sendRaw({ type: DATA_CHANNEL_TYPE.VALIDATION, topic: '', data: encryptValidationKey(data) }, true)
    }
  }

  private startHeartbeat() {
    if (this.hbTimer) clearInterval(this.hbTimer)
    this.lastInboundAt = Date.now()
    const beat = () => {
      // An open channel carrying nothing is not a link. Checked before the
      // beat, so a robot that has gone gets reported rather than beaten at.
      if (this.state === 'connected' && Date.now() - this.lastInboundAt > SILENCE_MS) {
        this.traffic('sys', `nothing from the robot for ${SILENCE_MS}ms`)
        // Stop beating as well as reporting. Declaring the link dead does not
        // tear anything down, so without this the interval went on talking to
        // a robot that had gone, every two seconds, until the page was closed.
        if (this.hbTimer) clearInterval(this.hbTimer)
        this.hbTimer = null
        this.setState('error', 'the robot stopped sending - the link is open but silent')
        return
      }
      const now = new Date()
      this.sendRaw(
        {
          type: DATA_CHANNEL_TYPE.HEARTBEAT,
          topic: '',
          data: { timeInStr: formatRobotTime(now), timeInNum: Math.floor(now.getTime() / 1000) },
        },
        true,
      )
    }
    beat()
    this.hbTimer = setInterval(beat, HEARTBEAT_MS)
  }

  // ---- pub / sub ----

  private sendSubscribe(topic: string) {
    if (this.live.has(topic)) return
    if (this.sendRaw({ type: DATA_CHANNEL_TYPE.SUBSCRIBE, topic })) this.live.add(topic)
  }

  subscribe(topic: string, cb: (data: unknown, message: ApiResponse) => void): () => void {
    let set = this.subs.get(topic)
    if (!set) {
      set = new Set()
      this.subs.set(topic, set)
    }
    set.add(cb)
    if (this.state === 'connected') this.sendSubscribe(topic)
    return () => {
      set.delete(cb)
      // The closure holds the set that was current when it was made. If this
      // topic has since been dropped and taken up again by someone else, that
      // is a different set, and tearing down on the strength of this one empty
      // would cancel a subscription still in use.
      if (set.size === 0 && this.subs.get(topic) === set) {
        this.subs.delete(topic)
        if (this.live.delete(topic)) this.sendRaw({ type: DATA_CHANNEL_TYPE.UNSUBSCRIBE, topic })
      }
    }
  }

  get subscribedTopics(): string[] {
    return [...this.live]
  }

  private dispatchTopic(topic: string, data: unknown, message: ApiResponse) {
    this.subs.get(topic)?.forEach((cb) => {
      try {
        cb(data, message)
      } catch (e) {
        console.error('topic handler threw', topic, e)
      }
    })
    this.emit('topic', { topic, data })
  }

  // ---- api calls ----

  private resolvePending(msg: ApiResponse) {
    const info = typeof msg.info === 'object' ? msg.info : undefined
    const id = msg.data?.header?.identity?.id ?? (info?.uuid as number | undefined)
    if (typeof id !== 'number') return
    const p = this.pending.get(id)
    if (!p) return
    this.pending.delete(id)
    clearTimeout(p.timer)
    p.resolve(msg)
  }

  private buildRequest(apiId: number, parameter?: unknown, extraHeader?: Record<string, unknown>) {
    const id = nextRequestId()
    const payload: Record<string, unknown> = {
      header: { identity: { id, api_id: apiId }, ...extraHeader },
      parameter: parameter === undefined ? '' : typeof parameter === 'string' ? parameter : JSON.stringify(parameter),
    }
    return { id, payload }
  }

  /** Request that waits for the robot's reply. */
  request(topic: string, apiId: number, parameter?: unknown, timeoutMs = REQUEST_TIMEOUT_MS): Promise<ApiResponse> {
    return new Promise<ApiResponse>((resolve, reject) => {
      if (!this.isOpen) {
        reject(new Error('Not connected'))
        return
      }
      const { id, payload } = this.buildRequest(apiId, parameter)
      this.sendRaw({ type: DATA_CHANNEL_TYPE.REQUEST, topic, data: payload })
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`No reply to api ${apiId} on ${topic} within ${timeoutMs}ms`))
      }, timeoutMs)
      // The robot answers a refused command with a non-zero status code. Reject
      // on those so a rejection can never be reported to the operator as
      // success - the reason a working button looked like a dead one.
      this.pending.set(id, {
        resolve: (msg) => {
          const code = msg.data?.header?.status?.code
          if (typeof code === 'number' && code !== 0) {
            reject(new Error(describeStatus(code)))
            return
          }
          resolve(msg)
        },
        reject,
        timer,
      })
    })
  }

  /**
   * Fire-and-forget call used for continuous streams like Move, where waiting
   * for a reply on every frame would stall the control loop.
   */
  sendNoReply(topic: string, apiId: number, parameter?: unknown, quiet = false) {
    const { payload } = this.buildRequest(apiId, parameter, { policy: { priority: 0, noreply: true } })
    this.sendRaw({ type: DATA_CHANNEL_TYPE.MSG, topic, data: { ...payload, binary: [] } }, quiet)
  }

  /**
   * A priority request: policy.priority = 1 makes the sport FSM jump the queue
   * instead of waiting behind an in-flight gait or action - what a real
   * emergency stop needs. Fire-and-forget.
   */
  sendPriority(topic: string, apiId: number, parameter?: unknown) {
    const { payload } = this.buildRequest(apiId, parameter, { policy: { priority: 1 } })
    this.sendRaw({ type: DATA_CHANNEL_TYPE.REQUEST, topic, data: payload })
  }

  /**
   * Ask the camera for a still. The JPEG comes back over the binary channel,
   * usually split across several frames, and is reassembled before this
   * resolves. Takes longer than a normal request on a busy link.
   */
  async capturePhoto(timeoutMs = 20000): Promise<Blob> {
    const res = await this.request(TOPICS.FRONT_PHOTO_REQ, 1001, undefined, timeoutMs)
    const binary = res.data?.binary as ArrayBuffer | undefined
    if (!binary || binary.byteLength === 0) {
      throw new Error('The robot answered without image data - is the video hub service running?')
    }
    return new Blob([binary], { type: 'image/jpeg' })
  }

  /** Publish a raw value on a topic (wireless controller, lidar switch, console). */
  publish(topic: string, data: unknown, type: string = DATA_CHANNEL_TYPE.MSG, quiet = false) {
    const msg: Record<string, unknown> = { type, topic }
    if (data !== undefined) msg.data = data
    this.sendRaw(msg, quiet)
  }

  // ---- stream toggles ----

  setVideo(on: boolean) {
    this.sendRaw({ type: DATA_CHANNEL_TYPE.VID, topic: '', data: on ? 'on' : 'off' })
  }

  setAudio(on: boolean) {
    this.sendRaw({ type: DATA_CHANNEL_TYPE.AUD, topic: '', data: on ? 'on' : 'off' })
  }

  /**
   * Traffic saving throttles high-bandwidth topics. Turn it off before
   * subscribing to the lidar or frames arrive at a crawl.
   */
  disableTrafficSaving(off: boolean): Promise<ApiResponse> {
    return new Promise((resolve, reject) => {
      if (!this.isOpen) {
        reject(new Error('Not connected'))
        return
      }
      const uuid = nextRequestId()
      this.sendRaw({
        type: DATA_CHANNEL_TYPE.RTC_INNER_REQ,
        topic: '',
        data: { req_type: 'disable_traffic_saving', instruction: off ? 'on' : 'off', uuid },
      })
      const timer = setTimeout(() => {
        this.pending.delete(uuid)
        reject(new Error('No reply to traffic-saving request'))
      }, REQUEST_TIMEOUT_MS)
      this.pending.set(uuid, { resolve, reject, timer })
    })
  }

}


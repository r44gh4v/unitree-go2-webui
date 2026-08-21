// Go2 WebRTC link: peer setup, validation handshake, heartbeat, pub/sub,
// api requests, binary frame parsing. Signaling goes through the local proxy at
// /api/connect; everything after that is browser <-> robot direct.
//
// Wire format transcribed from legion1581/unitree_webrtc_connect. Notable
// details: requests use type "req" (not "request"), `parameter` is always a
// JSON *string*, and responses are matched purely on header.identity.id.

import { md5 } from 'js-md5'
import { DATA_CHANNEL_TYPE, TOPICS } from './constants'
import { lastServerInfo } from './serverInfo'
import { decodeVoxelMesh, type VoxelMesh } from './voxel'

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

/** Parsed form of a request/response pair. Throws if the robot reported failure. */
export function unwrapResponse<T = unknown>(res: ApiResponse): T {
  const code = res.data?.header?.status?.code
  if (code !== undefined && code !== 0) throw new Error(`Robot returned status ${code}`)
  const raw = res.data?.data
  if (raw === undefined || raw === '') return undefined as T
  if (typeof raw !== 'string') return raw as T
  try {
    return JSON.parse(raw) as T
  } catch {
    return raw as unknown as T
  }
}

const HEARTBEAT_MS = 2000
const REQUEST_TIMEOUT_MS = 8000

function hexToBase64(hex: string): string {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  let bin = ''
  bytes.forEach((b) => (bin += String.fromCharCode(b)))
  return btoa(bin)
}

/** Decode a base64 string (a whole file, reassembled from chunks) into bytes. */
function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** Validation answer the robot expects: base64(md5_bytes("UnitreeGo2_" + key)). */
export function encryptValidationKey(key: string): string {
  return hexToBase64(md5(`UnitreeGo2_${key}`))
}

function genId(): number {
  return (Date.now() % 2147483648) + Math.floor(Math.random() * 1000)
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

/** In-flight file download over rtc_inner_req, keyed by its req_uuid. */
interface FileDownload {
  chunks: string[]
  resolve: (bytes: Uint8Array) => void
  reject: (e: Error) => void
  timer: ReturnType<typeof setTimeout>
}

/** Shape of the nested `file` object on a request_static_file response. */
interface FileResponse {
  enable_chunking?: boolean
  chunk_index?: number
  total_chunk_num?: number
  data?: string
}

/** Present on binary frames the robot had to split up. */
interface ChunkInfo {
  enable_chunking?: boolean
  chunk_index: number
  total_chunk_num: number
}

function concatChunks(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

export interface ConnectOptions {
  /** how to reach the robot; defaults to a direct address */
  method?: 'ip' | 'serial' | 'ap' | 'cloud'
  ip?: string
  /** robot serial number, for serial discovery and cloud relay */
  serial?: string
  /** Unitree cloud access token, required for the cloud method */
  token?: string
  /** per-device AES key (32 hex chars), required on firmware >= 1.1.15 */
  aesKey?: string
  region?: string
  /**
   * How a cloud robot is reached. 'auto' (the default) checks whether the
   * robot answers on the server's own network and connects directly when it
   * does, falling back to the relay when it does not or when the direct
   * attempt fails. 'relay' always goes through the cloud.
   */
  route?: 'auto' | 'relay'
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
  private pending = new Map<number, Pending>()
  private subs = new Map<string, Set<(data: unknown, message: ApiResponse) => void>>()
  private live = new Set<string>()
  /** partial binary payloads, keyed by request id or topic */
  private chunks = new Map<string | number, Uint8Array[]>()
  /** in-flight file downloads (SLAM map), keyed by req_uuid */
  private fileDownloads = new Map<string, FileDownload>()
  private msgCount = 0
  private byteCount = 0
  /** Bumped by every connect and disconnect so a superseded attempt can bail. */
  private generation = 0

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

    // Same-network shortcut: a "cloud" robot that answers on the server's own
    // LAN does not need the relay at all - signal it locally and the media
    // stays on this network. A serverless deployment has no LAN, so the check
    // is skipped there entirely rather than asked and answered no; a slow or
    // hung check must never stall the real connect.
    let viaShortcut = false
    const serverHasLan = lastServerInfo()?.serverless !== true
    if (method === 'cloud' && opts.serial && serverHasLan && (opts.route ?? 'auto') === 'auto') {
      try {
        const ctl = new AbortController()
        const t = setTimeout(() => ctl.abort(), 4000)
        const check = await fetch('/api/cloud/local-check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ serial: opts.serial }),
          signal: ctl.signal,
        })
        clearTimeout(t)
        const found = (await check.json()) as { ip?: string | null }
        if (stale()) return
        if (found.ip) {
          method = 'ip'
          targetIp = found.ip
          viaShortcut = true
          this.traffic('sys', `robot is on this network (${found.ip}) - connecting directly, skipping the relay`)
        }
      } catch {
        /* no LAN answer; carry on through the cloud */
      }
    }

    this.ip = method === 'ap' ? '192.168.12.1' : (targetIp || (opts.serial ?? ''))

    // A LAN robot is directly reachable, so an empty ICE config gathers fast.
    // A cloud robot is behind NAT: the browser must relay through the same TURN
    // server the robot uses, and that config has to be in place before the offer.
    let iceServers: RTCIceServer[] = []
    let turnServer: unknown = null
    if (method === 'cloud') {
      const turnResp = await fetch('/api/cloud/turn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serial: opts.serial ?? '', token: opts.token ?? '', region: opts.region ?? 'global' }),
      })
      if (stale()) return
      if (!turnResp.ok) {
        const body = (await turnResp.json().catch(() => ({}))) as { error?: string }
        const msg = body.error ?? 'Could not get relay credentials from the cloud'
        this.setState('error', msg)
        throw new Error(msg)
      }
      const turnBody = (await turnResp.json()) as { turnServer: unknown; iceServers: RTCIceServer[] }
      iceServers = turnBody.iceServers ?? []
      turnServer = turnBody.turnServer
      this.traffic('sys', `relay ready (${iceServers.length} ICE server${iceServers.length === 1 ? '' : 's'})`)
    }

    const pc = new RTCPeerConnection({ iceServers })
    this.pc = pc
    pc.addTransceiver('video', { direction: 'recvonly' })
    pc.addTransceiver('audio', { direction: 'recvonly' })

    pc.ontrack = (ev) => {
      this.mediaStream.addTrack(ev.track)
      this.emit('track', { kind: ev.track.kind, stream: this.mediaStream })
    }
    pc.onconnectionstatechange = () => {
      this.traffic('sys', `peer connection: ${pc.connectionState}`)
      if (pc.connectionState === 'failed') this.setState('error', 'peer connection failed')
      else if (pc.connectionState === 'disconnected' && this.state === 'connected') {
        this.setState('error', 'peer connection lost')
      }
    }

    const dc = pc.createDataChannel('data')
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
    await this.waitIceGathering(pc, method === 'cloud' ? 6000 : 2500)
    if (stale()) {
      pc.close()
      return
    }

    const resp = await fetch('/api/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method,
        ip: targetIp,
        serial: opts.serial ?? '',
        token: opts.token ?? '',
        aesKey: opts.aesKey ?? '',
        region: opts.region ?? 'global',
        turnServer,
        sdp: { sdp: pc.localDescription!.sdp, type: pc.localDescription!.type },
      }),
    })
    if (!resp.ok) {
      const body = (await resp.json().catch(() => ({}))) as { error?: string }
      const msg = body.error ?? `Signaling failed with HTTP ${resp.status}`
      // A superseded attempt must not report its failure over a live session.
      if (stale()) throw new Error(msg)
      // The direct attempt was an optimisation; its failure is not the user's
      // problem. Retry the same connect through the relay before giving up.
      if (viaShortcut) {
        pc.close()
        this.traffic('sys', `direct connect failed (${msg}) - retrying through the cloud relay`)
        return this.connect({ ...opts, route: 'relay' })
      }
      this.setState('error', msg)
      throw new Error(msg)
    }
    const answer = (await resp.json()) as { sdp: string; type: RTCSdpType; ip?: string }
    if (stale()) {
      pc.close()
      return
    }
    if (answer.ip) this.ip = answer.ip
    await pc.setRemoteDescription(new RTCSessionDescription(answer))
    this.traffic('sys', `SDP answer applied (${method}${this.ip ? ` · ${this.ip}` : ''})`)
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

  disconnect() {
    // Invalidate any connect still in flight so it cannot revive this session.
    this.generation++
    if (this.hbTimer) clearInterval(this.hbTimer)
    this.hbTimer = null
    this.pending.forEach((p) => {
      clearTimeout(p.timer)
      p.reject(new Error('Disconnected'))
    })
    this.pending.clear()
    this.fileDownloads.forEach((d) => {
      clearTimeout(d.timer)
      d.reject(new Error('Disconnected'))
    })
    this.fileDownloads.clear()
    this.live.clear()
    this.chunks.clear()
    try {
      this.dc?.close()
      this.pc?.close()
    } catch {
      /* already torn down */
    }
    this.dc = null
    this.pc = null
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
    if (msg.type !== DATA_CHANNEL_TYPE.HEARTBEAT && !NOISY_TOPICS.has(topic) && !isFileChunk) {
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
        if (isFileChunk && info) {
          this.handleFileChunk(info)
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
   * Binary frames carry a JSON header plus a payload. Two framings exist:
   * the classic one (uint16 LE header length at offset 0, JSON at 4), and a
   * lidar variant marked by a (2, 0) uint16 pair (uint32 LE length, JSON at 8).
   */
  private handleBinary(buf: ArrayBuffer) {
    try {
      const view = new DataView(buf)
      let jsonBytes: Uint8Array
      let payload: ArrayBuffer

      if (view.getUint16(0, true) === 2 && view.getUint16(2, true) === 0) {
        // Past the marker the length is a uint32, but the JSON still starts at
        // byte 8 - bytes 4 to 8 are reserved. Do not "simplify" this to 4 + len.
        const inner = buf.slice(4)
        const iv = new DataView(inner)
        const len = iv.getUint32(0, true)
        jsonBytes = new Uint8Array(inner, 8, len)
        payload = inner.slice(8 + len)
      } else {
        const len = view.getUint16(0, true)
        jsonBytes = new Uint8Array(buf, 4, len)
        payload = buf.slice(4 + len)
      }

      const header = JSON.parse(new TextDecoder().decode(jsonBytes)) as ApiResponse
      const topic = header.topic ?? ''

      // Large binary replies (a camera still, a map file) arrive split across
      // frames. Buffer them until the last chunk, then deliver the whole thing.
      const chunkInfo = (header.data as { content_info?: ChunkInfo } | undefined)?.content_info
      if (chunkInfo?.enable_chunking) {
        const key = header.data?.header?.identity?.id ?? topic
        const parts = this.chunks.get(key) ?? []
        parts.push(new Uint8Array(payload))
        if (chunkInfo.chunk_index < chunkInfo.total_chunk_num) {
          this.chunks.set(key, parts)
          return
        }
        this.chunks.delete(key)
        payload = concatChunks(parts).buffer as ArrayBuffer
      }

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
      } else {
        // A binary reply can also be the answer to a pending request, which is
        // how a camera still comes back.
        const id = header.data?.header?.identity?.id
        if (typeof id === 'number' && this.pending.has(id)) {
          const p = this.pending.get(id)!
          this.pending.delete(id)
          clearTimeout(p.timer)
          p.resolve({ ...header, data: { ...header.data, binary: payload } })
        }
        if (topic) this.dispatchTopic(topic, { ...(header.data as object), binary: payload }, header)
      }
    } catch (e) {
      this.traffic('sys', `binary frame parse failed: ${String((e as Error).message)}`)
    }
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
    const beat = () => {
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
      set!.delete(cb)
      if (set!.size === 0) {
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
    const id = genId()
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
      this.pending.set(id, { resolve, reject, timer })
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
      const uuid = genId()
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

  // ---- file transfer (SLAM map) ----

  /** Accumulate one chunk of a request_static_file response, keyed by req_uuid. */
  private handleFileChunk(info: Record<string, unknown>) {
    const reqUuid = info.req_uuid as string | undefined
    if (!reqUuid) return
    const dl = this.fileDownloads.get(reqUuid)
    if (!dl) return
    const file = info.file as FileResponse | undefined
    if (!file) {
      this.rejectDownload(reqUuid, new Error('File response carried no file object'))
      return
    }
    if (file.enable_chunking) {
      dl.chunks.push(file.data ?? '')
      // Last chunk: chunk_index reaches total_chunk_num (matches the Go app).
      if (
        file.chunk_index !== undefined &&
        file.total_chunk_num !== undefined &&
        file.chunk_index >= file.total_chunk_num
      ) {
        this.completeDownload(reqUuid)
      }
    } else if (file.data) {
      dl.chunks.push(file.data)
      this.completeDownload(reqUuid)
    } else {
      this.rejectDownload(reqUuid, new Error('File response was empty'))
    }
  }

  private completeDownload(reqUuid: string) {
    const dl = this.fileDownloads.get(reqUuid)
    if (!dl) return
    this.fileDownloads.delete(reqUuid)
    clearTimeout(dl.timer)
    try {
      // Chunks are base64 *text* and only decode correctly once joined.
      dl.resolve(base64ToBytes(dl.chunks.join('')))
    } catch (e) {
      dl.reject(e as Error)
    }
  }

  private rejectDownload(reqUuid: string, err: Error) {
    const dl = this.fileDownloads.get(reqUuid)
    if (!dl) return
    this.fileDownloads.delete(reqUuid)
    clearTimeout(dl.timer)
    dl.reject(err)
  }

  /**
   * Pull one static file off the robot over rtc_inner_req. The reply comes back
   * as a burst of base64 chunks that are joined and decoded here. Used for the
   * SLAM map files (map.pcd / map.pgm / map.txt).
   */
  downloadFile(filePath: string, timeoutMs = 30000): Promise<Uint8Array> {
    return new Promise<Uint8Array>((resolve, reject) => {
      if (!this.isOpen) {
        reject(new Error('Not connected'))
        return
      }
      const reqUuid = `req_${genId()}`
      const timer = setTimeout(() => {
        this.fileDownloads.delete(reqUuid)
        reject(new Error(`No file within ${timeoutMs}ms - has a map been built?`))
      }, timeoutMs)
      this.fileDownloads.set(reqUuid, { chunks: [], resolve, reject, timer })
      this.sendRaw({
        type: DATA_CHANNEL_TYPE.RTC_INNER_REQ,
        topic: '',
        data: {
          req_type: 'request_static_file',
          req_uuid: reqUuid,
          related_bussiness: 'uslam_final_pcd',
          file_md5: 'null',
          file_path: filePath,
        },
      })
    })
  }

  /**
   * Download the current SLAM map. The transfer is not re-entrant, so the three
   * files are pulled one after another. map.pcd (the point cloud) is required;
   * map.pgm and map.txt are optional and skipped if the robot has neither.
   */
  async downloadMap(onProgress?: (file: string) => void): Promise<{ name: string; bytes: Uint8Array }[]> {
    const out: { name: string; bytes: Uint8Array }[] = []
    for (const name of ['map.pcd', 'map.pgm', 'map.txt']) {
      onProgress?.(name)
      try {
        const bytes = await this.downloadFile(name)
        if (bytes.length) out.push({ name, bytes })
      } catch (e) {
        // The occupancy grid and metadata do not exist for every map; only a
        // missing point cloud is a real failure.
        if (name === 'map.pcd') throw e
        this.traffic('sys', `${name} not available: ${(e as Error).message}`)
      }
    }
    return out
  }
}


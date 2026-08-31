// Moving whole files between the console and the robot: the SLAM map coming
// back, and a map or config going out.
//
// This is its own job. It rides the same data channel as telemetry and api
// calls but shares nothing else with them - a different request type, its own
// correlation key, its own chunking scheme, and timeouts measured in tens of
// seconds rather than milliseconds. It sat in go2.ts only because that is where
// the channel happened to be.
//
// The channel it needs is narrow enough to state, so it takes one rather than
// the whole connection. That is also what makes it testable without a robot.

/** How much base64 text goes in one upload chunk. Matches the phone app. */
const UPLOAD_CHUNK = 30 * 1024

/** A breather every this many chunks; the firmware drops chunks sent faster. */
const PACE_EVERY = 5
const PACE_MS = 500

/** What this module needs from a link, and nothing more. */
export interface TransferChannel {
  /** True while the link can carry a frame. */
  isOpen(): boolean
  /** Send one rtc_inner_req payload. */
  send(data: Record<string, unknown>): void
  /** Say something in the traffic log. */
  note(text: string): void
  /** A correlation id unique within this session. */
  nextId(): string
}

/** One chunk of a file as the robot describes it. */
export interface FileResponse {
  data?: string
  enable_chunking?: boolean
  chunk_index?: number
  total_chunk_num?: number
}

/**
 * Join base64 chunks and decode once.
 *
 * The robot slices the *encoded text*, not the file, so a chunk boundary can
 * land inside a base64 quantum. Decoding each chunk and concatenating the bytes
 * would produce a file that is subtly and silently wrong. Join first, decode
 * once, always.
 */
export function joinBase64Chunks(chunks: string[]): Uint8Array {
  const joined = chunks.join('')
  if (!joined) return new Uint8Array(0)
  const bin = atob(joined)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/**
 * Encode bytes for the wire. Chunking for the robot happens after this, never
 * before - see joinBase64Chunks for why that order is not optional.
 *
 * Built up in 0x8000-byte spreads: a map is megabytes, and spreading that many
 * arguments into fromCharCode in one call overflows the stack.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  const step = 0x8000
  for (let i = 0; i < bytes.length; i += step) bin += String.fromCharCode(...bytes.subarray(i, i + step))
  return btoa(bin)
}

/** Cut encoded text into chunks small enough for the robot to accept. */
export function sliceForUpload(b64: string, size: number = UPLOAD_CHUNK): string[] {
  const out: string[] = []
  for (let i = 0; i < b64.length; i += size) out.push(b64.slice(i, i + size))
  return out
}

interface Download {
  chunks: string[]
  resolve: (bytes: Uint8Array) => void
  reject: (e: Error) => void
  timer: ReturnType<typeof setTimeout>
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export class FileTransfer {
  private downloads = new Map<string, Download>()
  private uploadAcks = new Map<string, (status: string | null) => void>()
  // Written out rather than a constructor parameter property: node strips type
  // annotations to run the tests, and a parameter property needs more than
  // stripping. Keeping this plain is what keeps the module testable.
  private readonly channel: TransferChannel

  constructor(channel: TransferChannel) {
    this.channel = channel
  }

  /** Fail everything in flight, for a link that has gone. */
  abandon(reason: string) {
    this.downloads.forEach((d) => {
      clearTimeout(d.timer)
      d.reject(new Error(reason))
    })
    this.downloads.clear()
    this.uploadAcks.forEach((ack) => ack(reason))
    this.uploadAcks.clear()
  }

  /** Route one inbound rtc_inner_req. Returns false if it was not ours. */
  handle(info: Record<string, unknown>): boolean {
    const reqUuid = typeof info.req_uuid === 'string' ? info.req_uuid : ''
    if (!reqUuid) return false

    const ack = this.uploadAcks.get(reqUuid)
    if (ack) {
      this.uploadAcks.delete(reqUuid)
      ack(typeof info.file_status === 'string' ? info.file_status : null)
      return true
    }

    const dl = this.downloads.get(reqUuid)
    if (!dl) return false

    const file = info.file as FileResponse | undefined
    if (!file) {
      this.fail(reqUuid, new Error('File response carried no file object'))
      return true
    }
    if (file.enable_chunking) {
      dl.chunks.push(file.data ?? '')
      // Last chunk: chunk_index reaches total_chunk_num, matching the Go app.
      if (
        file.chunk_index !== undefined &&
        file.total_chunk_num !== undefined &&
        file.chunk_index >= file.total_chunk_num
      ) {
        this.complete(reqUuid)
      }
    } else if (file.data) {
      dl.chunks.push(file.data)
      this.complete(reqUuid)
    } else {
      this.fail(reqUuid, new Error('File response was empty'))
    }
    return true
  }

  private complete(reqUuid: string) {
    const dl = this.downloads.get(reqUuid)
    if (!dl) return
    this.downloads.delete(reqUuid)
    clearTimeout(dl.timer)
    try {
      dl.resolve(joinBase64Chunks(dl.chunks))
    } catch (e) {
      dl.reject(e as Error)
    }
  }

  private fail(reqUuid: string, err: Error) {
    const dl = this.downloads.get(reqUuid)
    if (!dl) return
    this.downloads.delete(reqUuid)
    clearTimeout(dl.timer)
    dl.reject(err)
  }

  /**
   * Pull one static file off the robot. The reply arrives as a burst of base64
   * chunks. Used for the SLAM map files.
   */
  download(filePath: string, timeoutMs = 30000): Promise<Uint8Array> {
    return new Promise<Uint8Array>((resolve, reject) => {
      if (!this.channel.isOpen()) {
        reject(new Error('Not connected'))
        return
      }
      const reqUuid = `req_${this.channel.nextId()}`
      const timer = setTimeout(() => {
        this.downloads.delete(reqUuid)
        reject(new Error(`No file within ${timeoutMs}ms - has a map been built?`))
      }, timeoutMs)
      this.downloads.set(reqUuid, { chunks: [], resolve, reject, timer })
      this.channel.send({
        req_type: 'request_static_file',
        req_uuid: reqUuid,
        related_bussiness: 'uslam_final_pcd',
        file_md5: 'null',
        file_path: filePath,
      })
    })
  }

  /**
   * Download the current SLAM map. The transfer is not re-entrant, so the three
   * files come one after another. map.pcd is required; map.pgm and map.txt do
   * not exist for every map and are skipped when missing.
   */
  async downloadMap(onProgress?: (file: string) => void): Promise<{ name: string; bytes: Uint8Array }[]> {
    const out: { name: string; bytes: Uint8Array }[] = []
    for (const name of ['map.pcd', 'map.pgm', 'map.txt']) {
      onProgress?.(name)
      try {
        const bytes = await this.download(name)
        if (bytes.length) out.push({ name, bytes })
      } catch (e) {
        if (name === 'map.pcd') throw e
        this.channel.note(`${name} not available: ${(e as Error).message}`)
      }
    }
    return out
  }

  /**
   * Push a file to the robot, waiting for its per-chunk ack. The pacing matches
   * what the phone app does; the firmware drops chunks that arrive faster.
   *
   * This same channel can overwrite files on the robot, so callers should be
   * sure of the path they pass.
   */
  async upload(
    filePath: string,
    b64: string,
    business: string,
    onProgress?: (fraction: number) => void,
    ackTimeoutMs = 10000,
  ): Promise<void> {
    if (!this.channel.isOpen()) throw new Error('Not connected')
    const chunks = sliceForUpload(b64)
    if (!chunks.length) throw new Error(`${filePath} is empty`)

    for (let i = 0; i < chunks.length; i++) {
      // The robot needs a breather every few chunks or it starts dropping them.
      if (i > 0 && i % PACE_EVERY === 0) await sleep(PACE_MS)

      const reqUuid = `upload_req_${this.channel.nextId()}_${i}`
      const ack = new Promise<string | null>((resolve) => {
        this.uploadAcks.set(reqUuid, resolve)
        setTimeout(() => {
          if (this.uploadAcks.has(reqUuid)) resolve(null)
        }, ackTimeoutMs)
      })

      this.channel.send({
        req_type: 'push_static_file',
        req_uuid: reqUuid,
        related_bussiness: business,
        file_md5: 'null',
        file_path: filePath,
        file_size_after_b64: b64.length,
        file: {
          chunk_index: i + 1,
          total_chunk_num: chunks.length,
          chunk_data: chunks[i],
          chunk_data_size: chunks[i].length,
        },
      })

      const status = await ack
      this.uploadAcks.delete(reqUuid)
      if (status !== 'ok') {
        throw new Error(`${filePath}: chunk ${i + 1} of ${chunks.length} ${status ? `failed (${status})` : 'timed out'}`)
      }
      onProgress?.((i + 1) / chunks.length)
    }
    this.channel.note(`${filePath} uploaded (${chunks.length} chunks)`)
  }
  /** Restore a downloaded map bundle, one file after another. */
  async uploadMap(
    files: { name: string; bytes: Uint8Array }[],
    onProgress?: (file: string, fraction: number) => void,
  ): Promise<void> {
    for (const file of files) {
      await this.upload(file.name, bytesToBase64(file.bytes), 'uslam_final_pcd', (frac) =>
        onProgress?.(file.name, frac),
      )
    }
  }
}

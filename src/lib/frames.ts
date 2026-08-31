// Binary frames off the data channel: splitting one into its JSON header and
// its payload, and putting a chunked payload back together.
//
// Both length fields here come off the network, so nothing in this file trusts
// them. A frame that does not describe itself consistently is refused rather
// than allowed to throw from inside a DataView read, because the caller cannot
// tell a malformed frame from a bug in the parser once it is an exception.
//
// This file imports nothing, so node loads it straight from source and the
// tests run against the real byte handling rather than a reimplementation.

/** The chunking descriptor the robot puts in a split reply's header. */
export interface ChunkInfo {
  enable_chunking?: boolean
  chunk_index: number
  total_chunk_num: number
}

export interface Frame {
  /** The decoded JSON header. */
  header: {
    topic?: string
    data?: { header?: { identity?: { id?: number } }; content_info?: ChunkInfo } & Record<string, unknown>
  } & Record<string, unknown>
  payload: ArrayBuffer
}

/** The type-2 marker that introduces a lidar frame. */
const LIDAR_MARKER = 2

/**
 * Split one binary frame. Returns null when the bytes are not a frame this
 * understands - too short, a length that runs past the end, or a header that is
 * not JSON.
 *
 * Two layouts, and the offsets do not follow from each other:
 *
 *   standard  [uint16 jsonLen][2 reserved][JSON][payload]
 *   lidar     [uint16 = 2][uint16 = 0][uint32 jsonLen][4 reserved][JSON][payload]
 *
 * In the lidar layout the length moves to a uint32 at byte 4 but the JSON still
 * starts at byte 12, because bytes 8 to 12 are reserved. Collapsing that to
 * `8 + len` reads as an obvious simplification and is wrong.
 */
export function readFrame(buf: ArrayBuffer): Frame | null {
  if (buf.byteLength < 4) return null
  const view = new DataView(buf)

  let jsonStart: number
  let jsonLen: number
  if (view.getUint16(0, true) === LIDAR_MARKER && view.getUint16(2, true) === 0) {
    if (buf.byteLength < 12) return null
    jsonStart = 12
    jsonLen = view.getUint32(4, true)
  } else {
    jsonStart = 4
    jsonLen = view.getUint16(0, true)
  }

  const jsonEnd = jsonStart + jsonLen
  if (jsonEnd > buf.byteLength) return null

  let header: Frame['header']
  try {
    header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, jsonStart, jsonLen)))
  } catch {
    return null
  }
  if (!header || typeof header !== 'object') return null

  return { header, payload: buf.slice(jsonEnd) }
}

/**
 * Reassembles payloads that arrive split across frames - a camera still, a SLAM
 * map. Several can be in flight at once, so each is tracked under its own key.
 *
 * accept() returns the whole payload on the last chunk and null before then. An
 * unchunked payload passes straight through, so the caller has one path rather
 * than a branch on whether chunking was in play.
 */
export class ChunkAssembler {
  private parts = new Map<string | number, Uint8Array[]>()

  accept(key: string | number, info: ChunkInfo | undefined, payload: ArrayBuffer): ArrayBuffer | null {
    if (!info?.enable_chunking) return payload

    const soFar = this.parts.get(key) ?? []
    soFar.push(new Uint8Array(payload))

    if (info.chunk_index < info.total_chunk_num) {
      this.parts.set(key, soFar)
      return null
    }

    // Dropped on completion, so the next download under this key starts empty.
    this.parts.delete(key)
    return concat(soFar)
  }

  /** Forget everything in flight, for a link that has gone. */
  clear() {
    this.parts.clear()
  }
}

function concat(parts: Uint8Array[]): ArrayBuffer {
  let total = 0
  for (const p of parts) total += p.byteLength
  const out = new Uint8Array(total)
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.byteLength
  }
  return out.buffer
}

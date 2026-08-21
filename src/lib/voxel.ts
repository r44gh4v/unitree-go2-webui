// Lidar voxel decoding, pure TypeScript - no WASM.
//
// rt/utlidar/voxel_map_compressed carries an LZ4 raw block holding a bit-packed
// occupancy grid. Byte n of the decompressed buffer covers 8 voxels along x:
//   z = n >> 11, row = n & 0x7FF, y = row >> 4, x = ((row & 0xF) << 3) + bit
// with bit counted MSB-first. World position is voxel * resolution + origin.

export interface VoxelMeta {
  origin: number[]
  resolution: number
  width?: number[]
  src_size: number
}

export interface VoxelMesh {
  /** flat xyz triples in metres, 4 vertices per surviving face */
  positions: Float32Array
  /** rgb triples matching positions, height-shaded */
  colors: Float32Array
  /** two triangles (6 indices) per face */
  indices: Uint32Array
  /** surviving (visible) face count */
  faceCount: number
  /** occupied voxel count */
  voxelCount: number
  resolution: number
  origin: number[]
  ts: number
}

/**
 * LZ4 raw block decompression. The payload has no frame header and no length
 * prefix, so the output size has to come from the message's src_size field.
 */
export function lz4DecompressBlock(src: Uint8Array, expectedSize: number): Uint8Array {
  const dst = new Uint8Array(expectedSize)
  let sIdx = 0
  let dIdx = 0

  while (sIdx < src.length) {
    const token = src[sIdx++]

    // literals
    let literalLen = token >> 4
    if (literalLen === 0xf) {
      let more: number
      do {
        more = src[sIdx++]
        literalLen += more
      } while (more === 0xff && sIdx < src.length)
    }
    for (let i = 0; i < literalLen; i++) dst[dIdx++] = src[sIdx++]

    // the last block ends after its literals
    if (sIdx >= src.length) break

    // match
    const offset = src[sIdx++] | (src[sIdx++] << 8)
    if (offset === 0 || offset > dIdx) throw new Error(`LZ4 stream corrupt at ${sIdx} (offset ${offset})`)

    let matchLen = token & 0xf
    if (matchLen === 0xf) {
      let more: number
      do {
        more = src[sIdx++]
        matchLen += more
      } while (more === 0xff && sIdx < src.length)
    }
    matchLen += 4

    let mIdx = dIdx - offset
    for (let i = 0; i < matchLen; i++) dst[dIdx++] = dst[mIdx++]
  }

  return dst
}

/** Expand the occupancy bitmap into world-space points. */
export function bitsToPoints(buf: Uint8Array, origin: number[], resolution: number): Float32Array {
  // First pass: count set bits so the output can be exactly sized.
  let count = 0
  for (let n = 0; n < buf.length; n++) {
    let b = buf[n]
    while (b) {
      count += b & 1
      b >>= 1
    }
  }

  const out = new Float32Array(count * 3)
  const [ox, oy, oz] = [origin[0] ?? 0, origin[1] ?? 0, origin[2] ?? 0]
  let w = 0

  for (let n = 0; n < buf.length; n++) {
    const byte = buf[n]
    if (byte === 0) continue
    const z = n >> 11
    const row = n & 0x7ff
    const y = row >> 4
    const xBase = (row & 0xf) << 3
    for (let bit = 0; bit < 8; bit++) {
      if ((byte >> (7 - bit)) & 1) {
        out[w++] = (xBase + bit) * resolution + ox
        out[w++] = y * resolution + oy
        out[w++] = z * resolution + oz
      }
    }
  }

  return out
}

// The grid is 128 x 128 in x/y; z depth comes from the frame size.
const GRID = 128
const BYTES_PER_ROW = GRID >> 3 // 16
const BYTES_PER_SLICE = GRID * BYTES_PER_ROW // 2048 (0x800)

/** Is voxel (x, y, z) set? Direct index into the packed bit grid, MSB-first. */
function occupied(buf: Uint8Array, x: number, y: number, z: number, zLayers: number): boolean {
  if (x < 0 || x >= GRID || y < 0 || y >= GRID || z < 0 || z >= zLayers) return false
  const byte = buf[z * BYTES_PER_SLICE + y * BYTES_PER_ROW + (x >> 3)]
  return (byte & (0x80 >> (x & 7))) !== 0
}

// The six cube faces: neighbour direction, then the four corner offsets of the
// quad that faces that way. A face is drawn only when its neighbour is empty,
// so interior surfaces between solid voxels are never generated.
const FACES: { d: [number, number, number]; c: [number, number, number][] }[] = [
  { d: [-1, 0, 0], c: [[0, 1, 0], [0, 0, 0], [0, 1, 1], [0, 0, 1]] },
  { d: [1, 0, 0], c: [[1, 1, 1], [1, 0, 1], [1, 1, 0], [1, 0, 0]] },
  { d: [0, -1, 0], c: [[1, 0, 1], [0, 0, 1], [1, 0, 0], [0, 0, 0]] },
  { d: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [0, 1, 0], [1, 1, 0]] },
  { d: [0, 0, -1], c: [[1, 0, 0], [0, 0, 0], [1, 1, 0], [0, 1, 0]] },
  { d: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]] },
]

/** Crimson at the floor, salmon at mid, cream at the ceiling. */
function heightColor(t: number, out: Float32Array, at: number) {
  // clamp
  const u = t < 0 ? 0 : t > 1 ? 1 : t
  let r: number, g: number, b: number
  if (u < 0.5) {
    const k = u * 2 // crimson #9e122c -> salmon #f99d90
    r = (0x9e + (0xf9 - 0x9e) * k) / 255
    g = (0x12 + (0x9d - 0x12) * k) / 255
    b = (0x2c + (0x90 - 0x2c) * k) / 255
  } else {
    const k = (u - 0.5) * 2 // salmon -> cream #fcecdf
    r = (0xf9 + (0xfc - 0xf9) * k) / 255
    g = (0x9d + (0xec - 0x9d) * k) / 255
    b = (0x90 + (0xdf - 0x90) * k) / 255
  }
  out[at] = r
  out[at + 1] = g
  out[at + 2] = b
}

/**
 * Build a surface mesh from the occupancy grid: for each solid voxel, emit only
 * the faces whose neighbour is empty. This is what the robot's own viewer does
 * (its libvoxel.wasm), reimplemented here in TypeScript so there is no WASM to
 * load. It yields a solid, occluded surface instead of a cloud of dots.
 */
export function decodeVoxelMesh(payload: Uint8Array, meta: VoxelMeta): VoxelMesh {
  const buf = lz4DecompressBlock(payload, meta.src_size)
  const resolution = meta.resolution ?? 0.05
  const [ox, oy, oz] = [meta.origin?.[0] ?? 0, meta.origin?.[1] ?? 0, meta.origin?.[2] ?? 0]
  const zLayers = Math.floor(buf.length / BYTES_PER_SLICE)

  // First pass: count occupied voxels and surviving faces to size the buffers.
  let voxelCount = 0
  let faceCount = 0
  const visit = (fn: (x: number, y: number, z: number) => void) => {
    for (let n = 0; n < buf.length; n++) {
      const byte = buf[n]
      if (byte === 0) continue
      const z = n >> 11
      const y = (n & 0x7ff) >> 4
      const xBase = (n & 0xf) << 3
      for (let bit = 0; bit < 8; bit++) {
        if ((byte >> (7 - bit)) & 1) fn(xBase + bit, y, z)
      }
    }
  }
  visit((x, y, z) => {
    voxelCount++
    for (const f of FACES) {
      if (!occupied(buf, x + f.d[0], y + f.d[1], z + f.d[2], zLayers)) faceCount++
    }
  })

  const positions = new Float32Array(faceCount * 12)
  const colors = new Float32Array(faceCount * 12)
  const indices = new Uint32Array(faceCount * 6)

  // Height range for shading.
  const zSpan = Math.max(1, zLayers - 1)
  let fi = 0
  visit((x, y, z) => {
    for (const f of FACES) {
      if (occupied(buf, x + f.d[0], y + f.d[1], z + f.d[2], zLayers)) continue
      const vBase = fi * 4
      const pOff = fi * 12
      const t = z / zSpan
      for (let v = 0; v < 4; v++) {
        const c = f.c[v]
        positions[pOff + v * 3] = (x + c[0]) * resolution + ox
        positions[pOff + v * 3 + 1] = (y + c[1]) * resolution + oy
        positions[pOff + v * 3 + 2] = (z + c[2]) * resolution + oz
        heightColor(t, colors, pOff + v * 3)
      }
      const iOff = fi * 6
      indices[iOff] = vBase
      indices[iOff + 1] = vBase + 1
      indices[iOff + 2] = vBase + 2
      indices[iOff + 3] = vBase + 2
      indices[iOff + 4] = vBase + 1
      indices[iOff + 5] = vBase + 3
      fi++
    }
  })

  return {
    positions,
    colors,
    indices,
    faceCount,
    voxelCount,
    resolution,
    origin: [ox, oy, oz],
    ts: Date.now(),
  }
}

// LZ4 block decompression and voxel bit-unpacking, checked against
// hand-built blocks with known contents.
//
// voxel.ts is plain algorithmic TypeScript with no runtime imports; Node strips
// its type annotations on import (v22.18+), so it loads straight from source
// without a build step.
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const voxelPath = path.join(here, '..', 'src', 'lib', 'voxel.ts')
const { lz4DecompressBlock, bitsToPoints, decodeVoxelMesh } = await import(
  'file://' + voxelPath.replace(/\\/g, '/')
)

import { makeChecker } from './harness.mjs'
const { check, finish } = makeChecker()

const s = (b) => Buffer.from(b).toString('latin1')

check('literals only', s(lz4DecompressBlock(new Uint8Array([0x50, 72, 69, 76, 76, 79]), 5)), 'HELLO')

check('overlapping run', s(lz4DecompressBlock(new Uint8Array([0x1b, 65, 0x01, 0x00]), 16)), 'A'.repeat(16))

{
  const lits = Array.from({ length: 20 }, (_, i) => 97 + (i % 26))
  check('long literal run', s(lz4DecompressBlock(new Uint8Array([0xf0, 5, ...lits]), 20)), s(lits))
}

check('long match run', s(lz4DecompressBlock(new Uint8Array([0x2f, 65, 66, 0x02, 0x00, 3]), 24)), 'AB'.repeat(12))

check(
  'back reference',
  s(lz4DecompressBlock(new Uint8Array([0x62, 97, 98, 99, 100, 101, 102, 0x06, 0x00]), 12)),
  'abcdefabcdef',
)

// a corrupt offset must be rejected rather than silently producing garbage
{
  let threw = ''
  try {
    lz4DecompressBlock(new Uint8Array([0x11, 65, 0xff, 0x00]), 16)
  } catch (e) {
    threw = e.message
  }
  check('corrupt offset rejected', threw.includes('corrupt'), true)
}

// voxel geometry: byte index maps to (x, y, z), bit counted from the MSB
{
  const buf = new Uint8Array(0x800 * 2)
  buf[0] = 0b10000000 // n=0, first bit -> (0,0,0)
  buf[1] = 0b00000001 // n=1 -> y=0, xBase=8, last bit -> x=15
  buf[0x10] = 0b10000000 // n=16 -> y=1
  buf[0x800] = 0b10000000 // n=2048 -> z=1
  check('voxel geometry', Array.from(bitsToPoints(buf, [0, 0, 0], 1)), [0, 0, 0, 15, 0, 0, 0, 1, 0, 0, 0, 1])
}

{
  const buf = new Uint8Array(0x800)
  buf[0] = 0b10000000
  const pts = Array.from(bitsToPoints(buf, [1.5, -2, 0.25], 0.05)).map((v) => +v.toFixed(3))
  check('origin and resolution applied', pts, [1.5, -2, 0.25])
}

check('empty grid yields no points', Array.from(bitsToPoints(new Uint8Array(0x800), [0, 0, 0], 0.05)), [])

// Wrap raw bytes as a single LZ4 literal-only block (no match), with the
// literal-length token and its 0xff extension chain encoded correctly. The
// decoder ends the block after the literals, so no back-reference is needed.
function lz4Literals(bytes) {
  const out = []
  if (bytes.length < 15) {
    out.push(bytes.length << 4)
  } else {
    out.push(0xf0)
    let rem = bytes.length - 15
    while (rem >= 255) {
      out.push(255)
      rem -= 255
    }
    out.push(rem)
  }
  out.push(...bytes)
  return new Uint8Array(out)
}

// voxel mesh: a single isolated voxel exposes all six faces (none are culled),
// so 6 quads -> 24 verts (72 floats) and 12 triangles (36 indices).
{
  const grid = new Uint8Array(0x800)
  grid[0] = 0b10000000 // voxel at (0,0,0)
  const mesh = decodeVoxelMesh(lz4Literals(grid), { origin: [0, 0, 0], resolution: 1, src_size: grid.length })
  check('mesh voxel count', mesh.voxelCount, 1)
  check('mesh face count', mesh.faceCount, 6)
  check('mesh position floats', mesh.positions.length, 72)
  check('mesh index count', mesh.indices.length, 36)
  // a neighbour on +x hides the shared face on each voxel: 2 voxels, 10 faces
  grid[0] = 0b11000000 // voxels at (0,0,0) and (1,0,0)
  const mesh2 = decodeVoxelMesh(lz4Literals(grid), { origin: [0, 0, 0], resolution: 1, src_size: grid.length })
  check('mesh culls shared faces', [mesh2.voxelCount, mesh2.faceCount], [2, 10])
}

finish()

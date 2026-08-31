// Binary data-channel frame splitting and chunk reassembly.
//
// Two wire formats, both carrying their own length fields, both parsed by hand
// with byte offsets that do not follow from each other. This is exactly the code
// that should not be verified by pointing a robot at it.
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const modPath = path.join(here, '..', 'src', 'lib', 'frames.ts')
const { readFrame, ChunkAssembler } = await import('file://' + modPath.replace(/\\/g, '/'))

import { makeChecker } from './harness.mjs'
const { check, finish } = makeChecker()

const enc = new TextEncoder()
const bytes = (ab) => Array.from(new Uint8Array(ab))

/** Standard frame: [uint16 jsonLen][2 reserved][JSON][payload] */
function standardFrame(headerObj, payload = []) {
  const json = enc.encode(JSON.stringify(headerObj))
  const out = new Uint8Array(4 + json.length + payload.length)
  new DataView(out.buffer).setUint16(0, json.length, true)
  out.set(json, 4)
  out.set(payload, 4 + json.length)
  return out.buffer
}

/** Lidar frame: [uint16=2][uint16=0][uint32 jsonLen][4 reserved][JSON][payload] */
function lidarFrame(headerObj, payload = []) {
  const json = enc.encode(JSON.stringify(headerObj))
  const out = new Uint8Array(12 + json.length + payload.length)
  const dv = new DataView(out.buffer)
  dv.setUint16(0, 2, true)
  dv.setUint16(2, 0, true)
  dv.setUint32(4, json.length, true)
  out.set(json, 12)
  out.set(payload, 12 + json.length)
  return out.buffer
}

console.log('[frames] standard frame')
{
  const f = readFrame(standardFrame({ topic: 'rt/lf/lowstate' }, [1, 2, 3]))
  check('header parses', f.header.topic, 'rt/lf/lowstate')
  check('payload follows the json', bytes(f.payload), [1, 2, 3])
}
{
  const f = readFrame(standardFrame({ topic: 'x' }))
  check('an empty payload is empty, not null', bytes(f.payload), [])
}

console.log('[frames] lidar frame')
{
  // The trap: past the type marker the length is a uint32 at byte 4, but the
  // JSON still starts at byte 12 because bytes 8-12 are reserved.
  const f = readFrame(lidarFrame({ topic: 'rt/utlidar/voxel_map_compressed' }, [9, 8, 7, 6]))
  check('header parses', f.header.topic, 'rt/utlidar/voxel_map_compressed')
  check('reserved bytes are skipped, not counted', bytes(f.payload), [9, 8, 7, 6])
}

console.log('[frames] bytes that are not a frame')
{
  check('an empty buffer is refused', readFrame(new ArrayBuffer(0)), null)
  check('a runt buffer is refused', readFrame(new ArrayBuffer(3)), null)
}
{
  // A length field from the wire that runs past the end of the buffer. This
  // must be refused, not throw: it arrives from the network.
  const bad = new Uint8Array(8)
  new DataView(bad.buffer).setUint16(0, 9999, true)
  check('a json length past the end is refused', readFrame(bad.buffer), null)
}
{
  const bad = new Uint8Array(12)
  const dv = new DataView(bad.buffer)
  dv.setUint16(0, 2, true)
  dv.setUint16(2, 0, true)
  dv.setUint32(4, 0xffffff, true)
  check('a lidar json length past the end is refused', readFrame(bad.buffer), null)
}
{
  const notJson = new Uint8Array(4 + 3)
  new DataView(notJson.buffer).setUint16(0, 3, true)
  notJson.set(enc.encode('{[!'), 4)
  check('a header that is not json is refused', readFrame(notJson.buffer), null)
}

console.log('[frames] chunk reassembly')
{
  const a = new ChunkAssembler()
  const info = (i, n) => ({ enable_chunking: true, chunk_index: i, total_chunk_num: n })
  check('a middle chunk yields nothing yet', a.accept('k', info(1, 3), new Uint8Array([1]).buffer), null)
  check('nor does the next', a.accept('k', info(2, 3), new Uint8Array([2]).buffer), null)
  const done = a.accept('k', info(3, 3), new Uint8Array([3]).buffer)
  check('the last chunk yields the whole payload', bytes(done), [1, 2, 3])
}
{
  const a = new ChunkAssembler()
  const info = (i, n) => ({ enable_chunking: true, chunk_index: i, total_chunk_num: n })
  a.accept('one', info(1, 2), new Uint8Array([1]).buffer)
  a.accept('two', info(1, 2), new Uint8Array([9]).buffer)
  check('two downloads at once do not mix', bytes(a.accept('one', info(2, 2), new Uint8Array([2]).buffer)), [1, 2])
  check('and the other still completes', bytes(a.accept('two', info(2, 2), new Uint8Array([8]).buffer)), [9, 8])
}
{
  const a = new ChunkAssembler()
  const info = (i, n) => ({ enable_chunking: true, chunk_index: i, total_chunk_num: n })
  a.accept('k', info(1, 2), new Uint8Array([1]).buffer)
  a.accept('k', info(2, 2), new Uint8Array([2]).buffer)
  // Completing must clear the buffer, or a later download under the same key
  // inherits the last one's bytes.
  a.accept('k', info(1, 2), new Uint8Array([7]).buffer)
  check('a completed key starts empty next time', bytes(a.accept('k', info(2, 2), new Uint8Array([8]).buffer)), [7, 8])
}
{
  const a = new ChunkAssembler()
  check(
    'an unchunked frame passes straight through',
    bytes(a.accept('k', undefined, new Uint8Array([5]).buffer)),
    [5],
  )
}

finish()

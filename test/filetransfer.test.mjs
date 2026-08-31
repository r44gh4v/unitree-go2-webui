// Joining a file that arrived as base64 chunks.
//
// The robot sends a static file as a burst of base64 *text* chunks. Each chunk
// is a slice of the encoded string, not an independently encoded slice of the
// file, so decoding them one at a time and concatenating the bytes gives the
// wrong answer whenever a chunk boundary lands mid-quantum. That is a silent
// corruption - the bytes still arrive, just wrong - which is why it gets a test
// rather than a comment.
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const modPath = path.join(here, '..', 'src', 'lib', 'fileTransfer.ts')
const { joinBase64Chunks, sliceForUpload, bytesToBase64 } = await import('file://' + modPath.replace(/\\/g, '/'))

import { makeChecker } from './harness.mjs'
const { check, finish } = makeChecker()

const bytes = (u8) => Array.from(u8)

console.log('[filetransfer] joining base64 chunks')
{
  // "Hello" -> SGVsbG8= . Split at 3, which is mid-quantum on purpose.
  check('a whole string decodes', bytes(joinBase64Chunks(['SGVsbG8='])), [72, 101, 108, 108, 111])
  check('split mid-quantum still decodes', bytes(joinBase64Chunks(['SGV', 'sbG8='])), [72, 101, 108, 108, 111])
  check('split many ways still decodes', bytes(joinBase64Chunks(['S', 'G', 'V', 's', 'b', 'G', '8='])), [
    72, 101, 108, 108, 111,
  ])
}
{
  check('no chunks is empty, not a throw', bytes(joinBase64Chunks([])), [])
  check('empty chunks are empty', bytes(joinBase64Chunks(['', ''])), [])
}
{
  // Round-trip every byte value, split at a size that is coprime with 3 so the
  // boundaries land inside quanta.
  const all = new Uint8Array(256)
  for (let i = 0; i < 256; i++) all[i] = i
  const b64 = Buffer.from(all).toString('base64')
  const parts = []
  for (let i = 0; i < b64.length; i += 7) parts.push(b64.slice(i, i + 7))
  check('every byte value survives a chunked round trip', bytes(joinBase64Chunks(parts)), bytes(all))
}

console.log('[filetransfer] slicing a file for upload')
{
  const b64 = 'ABCDEFGHIJ'
  check('slices at the requested size', sliceForUpload(b64, 4), ['ABCD', 'EFGH', 'IJ'])
  check('a short file is one chunk', sliceForUpload('AB', 4), ['AB'])
  check('an empty file yields no chunks', sliceForUpload('', 4), [])
}

console.log('[filetransfer] encoding a whole map')
{
  // A map is megabytes. Encoding it must not spread that many arguments into
  // one fromCharCode call, which is a stack overflow rather than a slow path.
  const big = new Uint8Array(3 * 1024 * 1024)
  for (let i = 0; i < big.length; i++) big[i] = i & 0xff
  let encoded = null
  try {
    encoded = bytesToBase64(big)
  } catch (e) {
    encoded = 'threw: ' + e.message
  }
  check('a multi-megabyte file encodes without blowing the stack', encoded === Buffer.from(big).toString('base64'), true)
  check('and survives the chunked round trip', joinBase64Chunks(sliceForUpload(encoded)).length, big.length)
}

finish()

// Audio upload over the data channel.
//
// The robot takes WAV data as base64 split into 4 KB text chunks, each sent as a
// separate audiohub request carrying its index and the MD5 of the whole file.
// Ported from legion1581/unitree_webrtc_connect webrtc_audiohub.py.

import { md5 } from 'js-md5'
import { sleep } from './sleep'
import { AUDIO_API, TOPICS } from './constants'
import type { Go2Connection } from './go2'

const CHUNK_CHARS = 4096
/** The robot rejects anything that is not 44.1 kHz 16-bit PCM WAV. */
const TARGET_SAMPLE_RATE = 44100

function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  const step = 0x8000
  for (let i = 0; i < bytes.length; i += step) {
    bin += String.fromCharCode(...bytes.subarray(i, i + step))
  }
  return btoa(bin)
}

/** Encode decoded audio as a 16-bit PCM WAV at the rate the robot expects. */
function encodeWav(channelData: Float32Array, sampleRate: number): Uint8Array {
  const numSamples = channelData.length
  const buffer = new ArrayBuffer(44 + numSamples * 2)
  const view = new DataView(buffer)
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i))
  }

  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + numSamples * 2, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true) // PCM chunk size
  view.setUint16(20, 1, true) // format: PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true) // byte rate
  view.setUint16(32, 2, true) // block align
  view.setUint16(34, 16, true) // bits per sample
  writeStr(36, 'data')
  view.setUint32(40, numSamples * 2, true)

  let offset = 44
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, channelData[i]))
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true)
    offset += 2
  }
  return new Uint8Array(buffer)
}

/**
 * Decode any browser-supported audio file (MP3, WAV, OGG…) and re-encode it as
 * mono 44.1 kHz WAV, which is the only format the robot's player accepts.
 */
export async function toRobotWav(file: File): Promise<Uint8Array> {
  const raw = await file.arrayBuffer()
  const Ctx: typeof AudioContext =
    window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  const ctx = new Ctx({ sampleRate: TARGET_SAMPLE_RATE })
  try {
    const decoded = await ctx.decodeAudioData(raw.slice(0))
    // mix to mono
    const mono = new Float32Array(decoded.length)
    for (let ch = 0; ch < decoded.numberOfChannels; ch++) {
      const data = decoded.getChannelData(ch)
      for (let i = 0; i < decoded.length; i++) mono[i] += data[i] / decoded.numberOfChannels
    }
    return encodeWav(mono, decoded.sampleRate)
  } finally {
    void ctx.close()
  }
}

export interface UploadProgress {
  sent: number
  total: number
}

/**
 * Chunk a WAV as base64 and send each piece as its own audiohub request.
 * The library upload and the megaphone differ only in api id and the fields
 * that ride along with each chunk.
 */
async function sendInChunks(
  conn: Go2Connection,
  wav: Uint8Array,
  apiId: number,
  extraFields: (chunk: string, index: number, total: number) => Record<string, unknown>,
  onProgress?: (p: UploadProgress) => void,
): Promise<void> {
  const b64 = bytesToBase64(wav)
  const chunks: string[] = []
  for (let i = 0; i < b64.length; i += CHUNK_CHARS) chunks.push(b64.slice(i, i + CHUNK_CHARS))

  for (let i = 0; i < chunks.length; i++) {
    const parameter = {
      current_block_index: i + 1,
      total_block_number: chunks.length,
      block_content: chunks[i],
      current_block_size: chunks[i].length,
      ...extraFields(chunks[i], i, chunks.length),
    }
    await conn.request(TOPICS.AUDIO_HUB_REQ, apiId, JSON.stringify(parameter), 20000)
    onProgress?.({ sent: i + 1, total: chunks.length })
    // the robot needs a beat between chunks or it drops them
    await sleep(100)
  }
}

/** Send a prepared WAV to the robot's audio library. */
export async function uploadAudioFile(
  conn: Go2Connection,
  name: string,
  wav: Uint8Array,
  onProgress?: (p: UploadProgress) => void,
): Promise<void> {
  const fileMd5 = md5(wav)
  await sendInChunks(
    conn,
    wav,
    AUDIO_API.UPLOAD_AUDIO_FILE,
    () => ({
      file_name: name,
      file_type: 'wav',
      file_size: wav.length,
      file_md5: fileMd5,
      create_time: Date.now(),
    }),
    onProgress,
  )
}

/** Push a WAV straight out of the speaker in megaphone mode. */
export function uploadMegaphone(
  conn: Go2Connection,
  wav: Uint8Array,
  onProgress?: (p: UploadProgress) => void,
): Promise<void> {
  return sendInChunks(conn, wav, AUDIO_API.UPLOAD_MEGAPHONE, () => ({}), onProgress)
}

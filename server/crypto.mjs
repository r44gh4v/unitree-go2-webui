// Crypto primitives for the Go2 LAN signaling handshake.
// Ported from legion1581/unitree_webrtc_connect (encryption.py, unitree_auth.py).
// Parameters must match exactly or the robot rejects the offer.

import crypto from 'node:crypto'

/** Session key: 16 random bytes hex-encoded -> 32-char string, used as 32 ASCII bytes (AES-256). */
export function generateAesKey() {
  return crypto.randomBytes(16).toString('hex')
}

/** AES-256-ECB + PKCS7, base64 out. The 32-char key string is used as raw ASCII bytes, not hex-decoded. */
export function aesEncrypt(plaintext, key) {
  const cipher = crypto.createCipheriv('aes-256-ecb', Buffer.from(key, 'utf8'), null)
  cipher.setAutoPadding(true)
  return Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]).toString('base64')
}

export function aesDecrypt(b64, key) {
  const decipher = crypto.createDecipheriv('aes-256-ecb', Buffer.from(key, 'utf8'), null)
  decipher.setAutoPadding(true)
  return Buffer.concat([decipher.update(Buffer.from(b64, 'base64')), decipher.final()]).toString('utf8')
}

/** RSA/ECB/PKCS1Padding, chunked at keySize-11, concatenated, base64 out. */
export function rsaEncrypt(data, publicKey) {
  const keyBytes = publicKey.asymmetricKeyDetails?.modulusLength
    ? publicKey.asymmetricKeyDetails.modulusLength / 8
    : 256
  const maxChunk = keyBytes - 11
  const input = Buffer.from(data, 'utf8')
  const chunks = []
  for (let i = 0; i < input.length; i += maxChunk) {
    chunks.push(
      crypto.publicEncrypt(
        { key: publicKey, padding: crypto.constants.RSA_PKCS1_PADDING },
        input.subarray(i, i + maxChunk),
      ),
    )
  }
  return Buffer.concat(chunks).toString('base64')
}

/** The robot sends its public key base64-encoded; the decoded bytes are DER (SPKI). */
export function loadPublicKey(b64Pem) {
  const der = Buffer.from(b64Pem, 'base64')
  try {
    return crypto.createPublicKey({ key: der, format: 'der', type: 'spki' })
  } catch {
    return crypto.createPublicKey({ key: der, format: 'der', type: 'pkcs1' })
  }
}

// Static AES-GCM key for con_notify data2 === 2 (Go2 < 1.1.15). From the Unitree app.
const LEGACY_GCM_KEY = Buffer.from([232, 86, 130, 189, 22, 84, 155, 0, 142, 4, 166, 104, 43, 179, 235, 227])

/** GCM blob layout: [ciphertext][12-byte nonce][16-byte tag] */
function gcmDecrypt(b64, key) {
  const raw = Buffer.from(b64, 'base64')
  if (raw.length < 28) throw new Error('data1 too short for GCM decrypt')
  const tag = raw.subarray(raw.length - 16)
  const nonce = raw.subarray(raw.length - 28, raw.length - 16)
  const ciphertext = raw.subarray(0, raw.length - 28)
  const decipher = crypto.createDecipheriv('aes-128-gcm', key, nonce)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}

export function decryptData1Legacy(data1) {
  return gcmDecrypt(data1, LEGACY_GCM_KEY)
}

export function decryptData1V3(data1, aes128Hex) {
  if (!aes128Hex) {
    throw new Error(
      'This robot requires a per-device AES key (firmware >= 1.1.15). Get it from the Unitree cloud device list and enter it in the connection panel.',
    )
  }
  const key = Buffer.from(String(aes128Hex).trim().toLowerCase(), 'hex')
  if (key.length !== 16) throw new Error(`AES key must be 32 hex chars (16 bytes), got ${key.length} bytes`)
  try {
    return gcmDecrypt(data1, key)
  } catch {
    throw new Error('Robot rejected the AES key - check it matches this robot\'s serial number')
  }
}

/**
 * Derive the /con_ing_<ending> path segment: take the last 10 chars of the
 * decrypted data1, split into pairs, map each pair's second char (A-J) to its
 * index, concatenate the digits.
 */
export function calcLocalPathEnding(data1) {
  const strArr = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']
  const last10 = data1.slice(-10)
  let out = ''
  for (let i = 0; i < last10.length; i += 2) {
    const chunk = last10.slice(i, i + 2)
    if (chunk.length > 1) {
      const idx = strArr.indexOf(chunk[1])
      if (idx >= 0) out += String(idx)
    }
  }
  return out
}

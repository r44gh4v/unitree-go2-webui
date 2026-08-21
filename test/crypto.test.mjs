// Verify the signaling crypto against independently computed reference values.
import crypto from 'node:crypto'
import {
  aesEncrypt, aesDecrypt, generateAesKey, rsaEncrypt, loadPublicKey,
  calcLocalPathEnding, decryptData1Legacy, decryptData1V3,
} from '../server/crypto.mjs'

let pass = 0, fail = 0
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (ok) { pass++; console.log(`  ok   ${name}`) }
  else { fail++; console.log(`  FAIL ${name}\n       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`) }
}

// 1. AES key shape: 32 lowercase hex chars (used as 32 ASCII bytes = AES-256)
const key = generateAesKey()
check('aes key length', key.length, 32)
check('aes key is hex', /^[0-9a-f]{32}$/.test(key), true)

// 2. AES-256-ECB round trip
const sdp = JSON.stringify({ id: 'STA_localNetwork', sdp: 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n', type: 'offer', token: '' })
check('aes round trip', aesDecrypt(aesEncrypt(sdp, key), key), sdp)

// 3. ciphertext matches an independent aes-256-ecb encryption with the key as ASCII bytes
{
  const c = crypto.createCipheriv('aes-256-ecb', Buffer.from(key, 'utf8'), null)
  const ref = Buffer.concat([c.update('hello world', 'utf8'), c.final()]).toString('base64')
  check('aes matches reference', aesEncrypt('hello world', key), ref)
}

// 4. PKCS7 padding on an exact block boundary adds a full pad block (Python pad() does the same)
{
  const sixteen = '0123456789abcdef'
  const out = Buffer.from(aesEncrypt(sixteen, key), 'base64')
  check('pkcs7 full pad block', out.length, 32)
  check('pkcs7 unpads', aesDecrypt(aesEncrypt(sixteen, key), key), sixteen)
}

// 5. path ending: last 10 chars, pairs, second char A-J -> digit
check('path ending', calcLocalPathEnding('xxxxxxxxxxxxxxx1A2C3E4G5I'), '02468')
check('path ending zeros', calcLocalPathEnding('----------zAzAzAzAzA'), '00000')

// 6. RSA PKCS1 v1.5 wrap of the AES key, unwrapped with the matching private key
{
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
  const spkiDer = publicKey.export({ type: 'spki', format: 'der' })
  // the robot sends the key base64-encoded; loadPublicKey base64-decodes then imports DER
  const loaded = loadPublicKey(spkiDer.toString('base64'))
  const wrapped = rsaEncrypt(key, loaded)
  const unwrapped = crypto.privateDecrypt(
    { key: privateKey, padding: crypto.constants.RSA_PKCS1_PADDING },
    Buffer.from(wrapped, 'base64'),
  ).toString('utf8')
  check('rsa wrap/unwrap', unwrapped, key)
  check('rsa single block for 32-byte key', Buffer.from(wrapped, 'base64').length, 256)
}

// 7. legacy GCM data1 decrypt: build a blob the way the robot does
//    layout = ciphertext || nonce(12) || tag(16)
{
  const LEGACY = Buffer.from([232,86,130,189,22,84,155,0,142,4,166,104,43,179,235,227])
  const nonce = crypto.randomBytes(12)
  const plain = 'HEADER1234' + 'PUBLICKEYBODY' + 'ABCDEFGHIJ'
  const c = crypto.createCipheriv('aes-128-gcm', LEGACY, nonce)
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()])
  const blob = Buffer.concat([ct, nonce, c.getAuthTag()]).toString('base64')
  check('legacy gcm decrypt', decryptData1Legacy(blob), plain)
  // and the derived pieces the handshake needs
  const data1 = decryptData1Legacy(blob)
  check('pubkey slice', data1.slice(10, data1.length - 10), 'PUBLICKEYBODY')
  check('path from data1', calcLocalPathEnding(data1), '1357 9'.replace(' ', ''))
}

// 8. v3 per-device key path, including the missing-key error
{
  const devKey = crypto.randomBytes(16)
  const nonce = crypto.randomBytes(12)
  const plain = 'xxxxxxxxxxKEYxxxxxxxxxx'
  const c = crypto.createCipheriv('aes-128-gcm', devKey, nonce)
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()])
  const blob = Buffer.concat([ct, nonce, c.getAuthTag()]).toString('base64')
  check('v3 gcm decrypt', decryptData1V3(blob, devKey.toString('hex')), plain)

  let threw = ''
  try { decryptData1V3(blob, '') } catch (e) { threw = e.message }
  check('v3 requires a key', threw.includes('requires a per-device AES key'), true)

  threw = ''
  try { decryptData1V3(blob, crypto.randomBytes(16).toString('hex')) } catch (e) { threw = e.message }
  check('v3 rejects a wrong key', threw.includes('rejected'), true)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

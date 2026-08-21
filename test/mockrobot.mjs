// A stand-in Go2 that speaks both LAN signaling flows, so the real
// server/signaling.mjs can be driven end to end without hardware.
import http from 'node:http'
import crypto from 'node:crypto'


function pkcs7Unpad(buf) {
  const n = buf[buf.length - 1]
  return buf.subarray(0, buf.length - n)
}

export function startMockRobot({ port, flow = 'new', data2 = 1, aes128Key = null }) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
  const pubB64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64')

  // data1 = 10 chars of padding + base64 pubkey + a 10-char tail that encodes the path
  const head = 'HEADHEADHE'
  const tailPairs = ['1C', '2A', '3J', '4E', '5B']   // second chars C,A,J,E,B -> 2,0,9,4,1
  const tail = tailPairs.join('')
  const expectedPath = '20941'
  const data1Plain = head + pubB64 + tail

  let data1Field = data1Plain
  if (data2 === 2 || data2 === 3) {
    const key = data2 === 2
      ? Buffer.from([232,86,130,189,22,84,155,0,142,4,166,104,43,179,235,227])
      : Buffer.from(aes128Key, 'hex')
    const nonce = crypto.randomBytes(12)
    const c = crypto.createCipheriv('aes-128-gcm', key, nonce)
    const ct = Buffer.concat([c.update(data1Plain, 'utf8'), c.final()])
    data1Field = Buffer.concat([ct, nonce, c.getAuthTag()]).toString('base64')
  }

  const seen = { offer: null, path: null, id: null, token: null }

  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (d) => (body += d))
    req.on('end', () => {
      // legacy plaintext flow
      if (flow === 'old' && req.url === '/offer') {
        const offer = JSON.parse(body)
        seen.offer = offer.sdp
        seen.id = offer.id
        seen.token = offer.token
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ sdp: 'v=0\r\nMOCK-ANSWER-PLAIN\r\n', type: 'answer' }))
        return
      }

      if (req.url === '/con_notify') {
        res.writeHead(200)
        res.end(Buffer.from(JSON.stringify({ data1: data1Field, data2 })).toString('base64'))
        return
      }

      if (req.url.startsWith('/con_ing_')) {
        seen.path = req.url.slice('/con_ing_'.length)
        const payload = JSON.parse(body)
        // unwrap the AES key with our private key
        const aesKey = crypto.privateDecrypt(
          { key: privateKey, padding: crypto.constants.RSA_PKCS1_PADDING },
          Buffer.from(payload.data2, 'base64'),
        ).toString('utf8')
        // decrypt the offer
        const d = crypto.createDecipheriv('aes-256-ecb', Buffer.from(aesKey, 'utf8'), null)
        d.setAutoPadding(false)
        const plain = pkcs7Unpad(Buffer.concat([d.update(Buffer.from(payload.data1, 'base64')), d.final()])).toString('utf8')
        const offer = JSON.parse(plain)
        seen.offer = offer.sdp
        seen.id = offer.id
        seen.token = offer.token

        const answer = JSON.stringify({ sdp: 'v=0\r\nMOCK-ANSWER-ENCRYPTED\r\n', type: 'answer' })
        const c = crypto.createCipheriv('aes-256-ecb', Buffer.from(aesKey, 'utf8'), null)
        res.writeHead(200)
        res.end(Buffer.concat([c.update(answer, 'utf8'), c.final()]).toString('base64'))
        return
      }

      res.writeHead(404)
      res.end()
    })
  })

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve({ server, seen, expectedPath }))
  })
}

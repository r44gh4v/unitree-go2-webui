// Validating the address the console is asked to talk to.
//
// The robot address arrives in a request body and is interpolated straight into
// a URL the server then fetches. Without a check, "evil.com:80/path#" makes that
// URL point anywhere - the rest of the template is truncated by the fragment.
// The API is behind the password gate and the serverless deployment refuses LAN
// methods outright, so this is not wide open, but a signalling proxy should only
// ever reach a robot address.
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const { isRobotAddress } = await import('file://' + path.join(here, '..', 'server', 'address.mjs').replace(/\\/g, '/'))

import { makeChecker } from './harness.mjs'
const { check, finish } = makeChecker()

console.log('[address] real robot addresses')
for (const ok of ['192.168.12.1', '192.168.0.153', '10.0.0.7', '172.16.3.9', '127.0.0.1']) {
  check(`accepts ${ok}`, isRobotAddress(ok), true)
}

console.log('[address] anything that is not one')
for (const bad of [
  'evil.com:80/path#',
  'evil.com',
  'http://192.168.0.1',
  '192.168.0.1/con_notify',
  '192.168.0.1:9991',
  '192.168.0.1?x=1',
  '192.168.0.1#frag',
  '192.168.0.1 ',
  '[::1]',
  '999.1.1.1',
  '192.168.0',
  '192.168.0.1.5',
  '',
  '  ',
  'localhost',
]) {
  check(`refuses ${JSON.stringify(bad)}`, isRobotAddress(bad), false)
}

console.log('[address] not a string at all')
for (const bad of [null, undefined, 42, {}, []]) {
  check(`refuses ${JSON.stringify(bad) ?? 'undefined'}`, isRobotAddress(bad), false)
}

finish()

// Deciding how to reach the robot, and trading an offer for an answer.
//
// This is the branchiest part of connecting - five methods, a same-network
// shortcut that can hit or miss, relay credentials that can fail - and until it
// moved out of the connection it could only be exercised with a robot, a
// network and a proxy. Everything here runs against a stubbed fetch.
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const modPath = path.join(here, '..', 'src', 'lib', 'signalling.ts')
const { planRoute, exchangeOffer, canConnect, scanForRobots, resolveLanTarget } = await import(
  'file://' + modPath.replace(/\\/g, '/')
)

import { makeChecker } from './harness.mjs'
const { check, finish } = makeChecker()

/** A fetch stub that answers from a table and records what it was asked. */
function stubFetch(table) {
  const calls = []
  const fn = async (url, init) => {
    calls.push({ url, body: init?.body ? JSON.parse(init.body) : null })
    const entry = table[url]
    if (!entry) return { ok: false, status: 404, json: async () => ({ error: `no stub for ${url}` }) }
    if (entry.throws) throw new Error(entry.throws)
    return { ok: entry.ok !== false, status: entry.status ?? 200, json: async () => entry.body }
  }
  fn.calls = calls
  return fn
}

const OFFER = { sdp: 'v=0...', type: 'offer' }

console.log('[signalling] a plain LAN robot')
{
  const fetch = stubFetch({})
  const route = await planRoute({ method: 'ip', ip: '192.168.0.5' }, { fetch, serverHasLan: true })
  check('keeps the method', route.method, 'ip')
  check('keeps the address', route.targetIp, '192.168.0.5')
  check('needs no ice servers', route.iceServers, [])
  check('asks the network nothing', fetch.calls.length, 0)
}
{
  const fetch = stubFetch({})
  const route = await planRoute({ method: 'ap' }, { fetch, serverHasLan: true })
  check('the access point is a fixed address', route.ip, '192.168.12.1')
}

console.log('[signalling] a cloud robot that turns out to be on this network')
{
  const fetch = stubFetch({
    '/api/cloud/local-check': { body: { ip: '192.168.0.9' } },
  })
  const route = await planRoute({ method: 'cloud', serial: 'B42' }, { fetch, serverHasLan: true })
  check('drops to a direct connection', route.method, 'ip')
  check('uses the address it found', route.targetIp, '192.168.0.9')
  check('remembers it took the shortcut', route.viaShortcut, true)
  check('does not fetch relay credentials', fetch.calls.some((c) => c.url.includes('turn')), false)
  check('says so', route.notes.some((n) => n.includes('skipping the relay')), true)
}
{
  // The check is an optimisation. A server that cannot answer it must not stop
  // the connection, it just means going the long way.
  const fetch = stubFetch({
    '/api/cloud/local-check': { throws: 'network down' },
    '/api/cloud/turn': { body: { turnServer: { t: 1 }, iceServers: [{ urls: 'turn:x' }] } },
  })
  const route = await planRoute({ method: 'cloud', serial: 'B42' }, { fetch, serverHasLan: true })
  check('a failed check falls through to the relay', route.method, 'cloud')
  check('and still gets credentials', route.iceServers.length, 1)
}
{
  const fetch = stubFetch({
    '/api/cloud/local-check': { body: { ip: null } },
    '/api/cloud/turn': { body: { turnServer: { t: 1 }, iceServers: [{ urls: 'turn:x' }] } },
  })
  const route = await planRoute({ method: 'cloud', serial: 'B42' }, { fetch, serverHasLan: true })
  check('no answer on this network means the relay', route.method, 'cloud')
}

console.log('[signalling] when the shortcut must not be tried')
{
  const fetch = stubFetch({ '/api/cloud/turn': { body: { turnServer: null, iceServers: [] } } })
  await planRoute({ method: 'cloud', serial: 'B42' }, { fetch, serverHasLan: false })
  check('a server with no lan is not asked to scan one', fetch.calls.some((c) => c.url.includes('local-check')), false)
}
{
  const fetch = stubFetch({ '/api/cloud/turn': { body: { turnServer: null, iceServers: [] } } })
  await planRoute({ method: 'cloud', serial: 'B42', route: 'relay' }, { fetch, serverHasLan: true })
  check('asking for the relay skips the check', fetch.calls.some((c) => c.url.includes('local-check')), false)
}
{
  const fetch = stubFetch({ '/api/cloud/turn': { body: { turnServer: null, iceServers: [] } } })
  await planRoute({ method: 'cloud' }, { fetch, serverHasLan: true })
  check('no serial means nothing to look for', fetch.calls.some((c) => c.url.includes('local-check')), false)
}

console.log('[signalling] relay credentials that do not come')
{
  const fetch = stubFetch({
    '/api/cloud/local-check': { body: { ip: null } },
    '/api/cloud/turn': { ok: false, status: 502, body: { error: 'Sign in to your Unitree account first' } },
  })
  let msg = null
  try {
    await planRoute({ method: 'cloud', serial: 'B42' }, { fetch, serverHasLan: true })
  } catch (e) {
    msg = e.message
  }
  check("the robot's reason reaches the operator", msg, 'Sign in to your Unitree account first')
}
{
  const fetch = stubFetch({
    '/api/cloud/local-check': { body: { ip: null } },
    '/api/cloud/turn': { ok: false, status: 500, body: {} },
  })
  let msg = null
  try {
    await planRoute({ method: 'cloud', serial: 'B42' }, { fetch, serverHasLan: true })
  } catch (e) {
    msg = e.message
  }
  check('a reasonless failure still says something', msg, 'Could not get relay credentials from the cloud')
}

console.log('[signalling] trading the offer')
{
  const fetch = stubFetch({ '/api/connect': { body: { sdp: 'v=0 answer', type: 'answer', ip: '192.168.0.5' } } })
  const route = { method: 'ip', targetIp: '192.168.0.5', ip: '192.168.0.5', iceServers: [], turnServer: null, viaShortcut: false, notes: [] }
  const res = await exchangeOffer(OFFER, route, { aesKey: 'KEY' }, { fetch, serverHasLan: true })
  check('returns the answer', res.answer.sdp, 'v=0 answer')
  check('returns the address the robot answered on', res.ip, '192.168.0.5')
  const sent = fetch.calls[0].body
  check('sends the offer intact', sent.sdp, OFFER)
  check('sends the device key', sent.aesKey, 'KEY')
  check('sends the method', sent.method, 'ip')
}
{
  const fetch = stubFetch({ '/api/connect': { ok: false, status: 502, body: { error: 'The robot already has a client connected.' } } })
  const route = { method: 'ip', targetIp: '1.2.3.4', ip: '1.2.3.4', iceServers: [], turnServer: null, viaShortcut: false, notes: [] }
  let msg = null
  try {
    await exchangeOffer(OFFER, route, {}, { fetch, serverHasLan: true })
  } catch (e) {
    msg = e.message
  }
  check("the robot's own reason is preserved", msg, 'The robot already has a client connected.')
}
{
  const fetch = stubFetch({ '/api/connect': { ok: false, status: 500, body: {} } })
  const route = { method: 'cloud', targetIp: '', ip: '', iceServers: [], turnServer: null, viaShortcut: false, notes: [] }
  let msg = null
  try {
    await exchangeOffer(OFFER, route, {}, { fetch, serverHasLan: true })
  } catch (e) {
    msg = e.message
  }
  check('an unexplained failure names the status', msg, 'Signaling failed with HTTP 500')
}

console.log('[signalling] what each method needs before Connect can be pressed')
{
  const f = { ip: '', serial: '', token: '', pickedSerial: '' }
  check('ip needs an address', canConnect('ip', f), false)
  check('whitespace is not an address', canConnect('ip', { ...f, ip: '   ' }), false)
  check('an address is enough', canConnect('ip', { ...f, ip: '192.168.0.5' }), true)
  check('serial needs the number', canConnect('serial', f), false)
  check('a serial is enough', canConnect('serial', { ...f, serial: 'B42' }), true)
  check('the access point needs nothing typed', canConnect('ap', f), true)
  check('lan needs nothing typed', canConnect('lan', f), true)
  check('cloud needs a signed-in account', canConnect('cloud', { ...f, pickedSerial: 'B42' }), false)
  check('cloud needs a picked robot', canConnect('cloud', { ...f, token: 't' }), false)
  check('cloud with both connects', canConnect('cloud', { ...f, token: 't', pickedSerial: 'B42' }), true)
}

console.log('[signalling] scanning this network for robots')
{
  const fetch = stubFetch({ '/api/discover': { body: { robots: [{ ip: '192.168.0.7', sn: 'B42' }] } } })
  const robots = await scanForRobots({ fetch, serverHasLan: true })
  check('returns what the server found', robots, [{ ip: '192.168.0.7', sn: 'B42' }])
}
{
  const fetch = stubFetch({ '/api/discover': { ok: false, status: 500, body: { error: 'multicast failed', robots: [] } } })
  let msg = null
  try {
    await scanForRobots({ fetch, serverHasLan: true })
  } catch (e) {
    msg = e.message
  }
  check("the server's reason reaches the operator", msg, 'multicast failed')
}

console.log('[signalling] lan means the first robot on this router')
{
  const fetch = stubFetch({ '/api/discover': { body: { robots: [{ ip: '192.168.0.7' }] } } })
  const found = await resolveLanTarget({ fetch, serverHasLan: true })
  check('one robot is taken silently', found, { ip: '192.168.0.7', note: null })
}
{
  const fetch = stubFetch({ '/api/discover': { body: { robots: [{ ip: '192.168.0.7' }, { ip: '192.168.0.8' }] } } })
  const found = await resolveLanTarget({ fetch, serverHasLan: true })
  check('several robots names the choice made', found.note, 'Found 2 robots, using 192.168.0.7.')
}
{
  const fetch = stubFetch({ '/api/discover': { body: { robots: [] } } })
  let msg = null
  try {
    await resolveLanTarget({ fetch, serverHasLan: true })
  } catch (e) {
    msg = e.message
  }
  check('none found says what to try', msg, 'No robot answered on this network. Check both are on the same router, or use IP.')
}

finish()

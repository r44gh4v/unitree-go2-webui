// Restoring a saved Unitree account session.
//
// A cached session holds an access token and the robots bound to the account.
// Deciding whether a saved one is still usable is the only part of signing in
// that is pure, and it is the part that matters: accepting a stale or malformed
// save means the console shows robots the operator cannot reach and an access
// token the cloud will refuse.
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const modPath = path.join(here, '..', 'src', 'lib', 'cloudSession.ts')
const { readStoredSession, SESSION_TTL_MS } = await import('file://' + modPath.replace(/\\/g, '/'))

import { makeChecker } from './harness.mjs'
const { check, finish } = makeChecker()

const NOW = 1_700_000_000_000
const ROBOTS = [{ sn: 'B42-1', name: 'Go2', aesKey: 'abc' }]
const save = (o) => JSON.stringify(o)

console.log('[cloudsession] a good save')
{
  const s = readStoredSession(save({ token: 't', robots: ROBOTS, at: NOW - 1000 }), NOW)
  check('restores the token', s.token, 't')
  check('restores the robots', s.robots, ROBOTS)
}
{
  const s = readStoredSession(save({ token: 't', robots: ROBOTS, at: NOW - SESSION_TTL_MS + 5000 }), NOW)
  check('a save just inside the window is kept', s !== null, true)
}

console.log('[cloudsession] saves that must not be trusted')
{
  check('nothing saved', readStoredSession(null, NOW), null)
  check('empty string', readStoredSession('', NOW), null)
  check('not json', readStoredSession('{oh no', NOW), null)
  check('json that is not an object', readStoredSession('42', NOW), null)
  check('null literal', readStoredSession('null', NOW), null)
}
{
  check('no token', readStoredSession(save({ robots: ROBOTS, at: NOW }), NOW), null)
  check('empty token', readStoredSession(save({ token: '', robots: ROBOTS, at: NOW }), NOW), null)
  check('no robots', readStoredSession(save({ token: 't', at: NOW }), NOW), null)
  check('empty robot list', readStoredSession(save({ token: 't', robots: [], at: NOW }), NOW), null)
  check('robots not an array', readStoredSession(save({ token: 't', robots: {}, at: NOW }), NOW), null)
}
{
  check('expired', readStoredSession(save({ token: 't', robots: ROBOTS, at: NOW - SESSION_TTL_MS - 1 }), NOW), null)
  check('no timestamp counts as ancient', readStoredSession(save({ token: 't', robots: ROBOTS }), NOW), null)
  // A save stamped in the future is either a clock change or a forgery; either
  // way its age cannot be judged, so it is not trusted.
  check('stamped in the future', readStoredSession(save({ token: 't', robots: ROBOTS, at: NOW + 60_000 }), NOW), null)
}
{
  // A robot entry without a serial is unusable - it is what gets connected to.
  check(
    'a robot with no serial is refused',
    readStoredSession(save({ token: 't', robots: [{ name: 'Go2' }], at: NOW }), NOW),
    null,
  )
}

finish()

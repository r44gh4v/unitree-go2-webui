// Whether an action can be sent, and what to tell the operator about it.
//
// The same action has different api ids on each motion service, and our tables
// are transcriptions rather than the robot's own manifest - so an action missing
// from the running service may simply be missing from our notes. Deciding what
// to do about that was spread across the tile: the panel read a raw id, an
// "exact" flag and a service name, then worked out on its own whether to grey
// the tile, dash its border, and what to say in the tooltip.
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const modPath = path.join(here, '..', 'src', 'lib', 'actionAvailability.ts')
const { resolveAction } = await import('file://' + modPath.replace(/\\/g, '/'))

import { makeChecker } from './harness.mjs'
const { check, finish } = makeChecker()

const act = (ids) => ({ name: 'Test', label: 'Test move', ids, kind: 'oneShot', group: 'posture' })

console.log('[availability] the running service lists it')
{
  const r = resolveAction(act({ normal: 1001, mcf: 2001 }), 'mcf')
  check('uses the running service id', r.apiId, 2001)
  check('is listed', r.standing, 'listed')
  check('is usable', r.usable, true)
  check('is not marked untested', r.untested, false)
  check('says nothing alarming', r.why, null)
}

console.log('[availability] the running service does not list it')
{
  // Not a refusal. The robot may well accept it, and if it does not it answers
  // "API not registered" - which beats the console deciding on the robot's
  // behalf that a button cannot be pressed.
  const r = resolveAction(act({ normal: 1001 }), 'mcf')
  check('borrows an id rather than giving up', r.apiId, 1001)
  check('is marked borrowed', r.standing, 'borrowed')
  check('is still usable', r.usable, true)
  check('is marked untested', r.untested, true)
  check('names the service it borrowed from', r.borrowedFrom, 'normal')
  check('explains itself', r.why.includes('mcf') && r.why.includes('normal'), true)
}
{
  // Preference order when several services have one: the newest first, because
  // a robot running mcf is likelier to accept an mcf id than a legacy one.
  const r = resolveAction(act({ normal: 1001, ai: 1500, advanced: 1300, mcf: 2001 }), 'ai')
  check('an exact match still wins over the order', r.apiId, 1500)
  const b = resolveAction(act({ normal: 1001, advanced: 1300, mcf: 2001 }), 'ai')
  check('otherwise the newest service is preferred', b.borrowedFrom, 'mcf')
  const c = resolveAction(act({ normal: 1001, advanced: 1300 }), 'ai')
  check('then advanced', c.borrowedFrom, 'advanced')
  const d = resolveAction(act({ normal: 1001 }), 'ai')
  check('then normal', d.borrowedFrom, 'normal')
}

console.log('[availability] nothing known at all')
{
  const r = resolveAction(act({}), 'mcf')
  check('has no id', r.apiId, null)
  check('is unknown', r.standing, 'unknown')
  check('is not usable', r.usable, false)
  check('is not merely untested', r.untested, false)
  check('says so', r.why.length > 0, true)
}

console.log('[availability] the tile does not have to know the protocol')
{
  const listed = resolveAction(act({ mcf: 2001 }), 'mcf')
  const borrowed = resolveAction(act({ normal: 1 }), 'mcf')
  const unknown = resolveAction(act({}), 'mcf')
  // Three states, and every question a tile asks is answered by one of them.
  check('the three standings are distinct', [listed.standing, borrowed.standing, unknown.standing], [
    'listed', 'borrowed', 'unknown',
  ])
  check('usable and untested fully describe the tile', [
    [listed.usable, listed.untested],
    [borrowed.usable, borrowed.untested],
    [unknown.usable, unknown.untested],
  ], [[true, false], [true, true], [false, false]])
}

finish()

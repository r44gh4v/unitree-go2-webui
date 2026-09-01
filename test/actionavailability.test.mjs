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
  // Preference order when several services have one, and an exact match always
  // wins regardless of order.
  const r = resolveAction(act({ normal: 1001, ai: 1500, advanced: 1300, mcf: 2001 }), 'ai')
  check('an exact match still wins over the order', r.apiId, 1500)
}

console.log('[availability] mcf borrows from legacy before legacy borrows from mcf')
{
  // mcf ids do not exist on a legacy service at all - sending one there is
  // sending a command id that is definitionally not on that service's
  // manifest. A robot running mcf has no such problem borrowing from a legacy
  // sibling, so it is legacy that is preferred, in both directions.
  const fromMcf = resolveAction(act({ normal: 1001, ai: 1500, advanced: 1300 }), 'mcf')
  check('mcf prefers normal first', fromMcf.borrowedFrom, 'normal')
  const fromMcfNoNormal = resolveAction(act({ ai: 1500, advanced: 1300 }), 'mcf')
  check('mcf then ai', fromMcfNoNormal.borrowedFrom, 'ai')
  const fromMcfOnlyAdvanced = resolveAction(act({ advanced: 1300 }), 'mcf')
  check('mcf then advanced', fromMcfOnlyAdvanced.borrowedFrom, 'advanced')
}
{
  const fromNormal = resolveAction(act({ ai: 1500, advanced: 1300, mcf: 2001 }), 'normal')
  check('normal prefers ai first', fromNormal.borrowedFrom, 'ai')
  const fromNormalNoAi = resolveAction(act({ advanced: 1300, mcf: 2001 }), 'normal')
  check('normal then advanced', fromNormalNoAi.borrowedFrom, 'advanced')
  const fromNormalOnlyMcf = resolveAction(act({ mcf: 2001 }), 'normal')
  check('normal reaches mcf only as a last resort', fromNormalOnlyMcf.borrowedFrom, 'mcf')
}
{
  const fromAi = resolveAction(act({ normal: 1001, advanced: 1300, mcf: 2001 }), 'ai')
  check('ai prefers advanced first', fromAi.borrowedFrom, 'advanced')
  const fromAiNoAdvanced = resolveAction(act({ normal: 1001, mcf: 2001 }), 'ai')
  check('ai then normal', fromAiNoAdvanced.borrowedFrom, 'normal')
  const fromAiOnlyMcf = resolveAction(act({ mcf: 2001 }), 'ai')
  check('ai reaches mcf only as a last resort', fromAiOnlyMcf.borrowedFrom, 'mcf')
}
{
  const fromAdvanced = resolveAction(act({ normal: 1001, ai: 1500, mcf: 2001 }), 'advanced')
  check('advanced prefers ai first', fromAdvanced.borrowedFrom, 'ai')
  const fromAdvancedNoAi = resolveAction(act({ normal: 1001, mcf: 2001 }), 'advanced')
  check('advanced then normal', fromAdvancedNoAi.borrowedFrom, 'normal')
  const fromAdvancedOnlyMcf = resolveAction(act({ mcf: 2001 }), 'advanced')
  check('advanced reaches mcf only as a last resort', fromAdvancedOnlyMcf.borrowedFrom, 'mcf')
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

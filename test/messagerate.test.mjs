// Turning a running message count into a rate the operator can read.
//
// This is the one number that tells a live robot from a frozen one: the other
// readings look perfectly healthy when the link has died. Getting it wrong in
// the quiet direction is the failure that matters.
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const modPath = path.join(here, '..', 'src', 'lib', 'messageRate.ts')
const { MessageRate, RATE_WINDOW_MS } = await import('file://' + modPath.replace(/\\/g, '/'))

import { makeChecker } from './harness.mjs'
const { check, finish } = makeChecker()

const W = RATE_WINDOW_MS

console.log('[messagerate] getting started')
{
  const r = new MessageRate()
  check('the first sample only sets a baseline', r.sample(100, 1000), 0)
}
{
  const r = new MessageRate()
  r.sample(0, 1000)
  check('a sample inside the window does not update', r.sample(50, 1000 + W - 1), 0)
}

console.log('[messagerate] a steady stream')
{
  const r = new MessageRate()
  r.sample(0, 0)
  // 100 messages in one second is 100/s, and the first real reading is taken
  // as-is rather than smoothed toward zero from nothing.
  check('the first real reading is not dragged down by an empty average', r.sample(100, 1000), 100)
}
{
  const r = new MessageRate()
  r.sample(0, 0)
  r.sample(100, 1000)
  // Smoothing is deliberate: the raw number jitters every update.
  check('a change is smoothed rather than jumping', r.sample(300, 2000), 150)
  check('and converges toward the truth', Math.round(r.sample(500, 3000)), 175)
}

console.log('[messagerate] a fresh connection')
{
  const r = new MessageRate()
  r.sample(0, 0)
  r.sample(1000, 1000)
  // The count restarts at zero on a new link. Subtracting the old total gives a
  // negative delta, which would read as a dead link on a healthy one.
  const after = r.sample(40, 2000)
  check('a counter that restarted is not read as negative', after > 0, true)
  check('and the new count is used as the delta', Math.round(after), 520)
}
{
  const r = new MessageRate()
  r.sample(0, 0)
  r.sample(100, 1000)
  r.reset()
  check('a reset starts over cleanly', r.sample(50, 2000), 0)
}

console.log('[messagerate] a link that went quiet')
{
  const r = new MessageRate()
  r.sample(0, 0)
  r.sample(100, 1000)
  // Nothing arriving must fall toward zero, not hold the last good number.
  const quiet = [r.sample(100, 2000), r.sample(100, 3000), r.sample(100, 4000)]
  check('silence pulls the rate down', quiet[0] < 100, true)
  check('and keeps pulling', quiet[2] < quiet[0], true)
  check('toward nothing', quiet[2] < 15, true)
}

finish()

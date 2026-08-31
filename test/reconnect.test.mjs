// Reconnect policy: when a dropped link should come back, and when it should
// not. These rules used to be four refs inside a React effect and could only be
// exercised by unplugging a real robot. reconnect.ts imports nothing, so node
// strips its type annotations and loads it straight from source.
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const modPath = path.join(here, '..', 'src', 'lib', 'reconnect.ts')
const { ReconnectPolicy } = await import('file://' + modPath.replace(/\\/g, '/'))

import { makeChecker } from './harness.mjs'
const { check, finish } = makeChecker()

const SCHEDULE = [10, 20, 30]
const fresh = () => new ReconnectPolicy(SCHEDULE)
const DETAILS = { method: 'ip', ip: '192.168.0.5' }

console.log('[reconnect] a link that never worked')
{
  const p = fresh()
  p.opening(DETAILS)
  check('a first attempt that fails is not retried', p.afterLoss(), { act: 'stand-down', why: 'never-worked' })
}
{
  const p = fresh()
  check('a loss with no connection ever attempted stands down', p.afterLoss(), {
    act: 'stand-down',
    why: 'nothing-to-reopen',
  })
}

console.log('[reconnect] a link that worked')
{
  const p = fresh()
  p.opening(DETAILS)
  p.established()
  check('first loss reopens on the first wait', p.afterLoss(), {
    act: 'reopen',
    after: 10,
    attempt: 1,
    of: 3,
    details: DETAILS,
  })
  check('second loss backs off', p.afterLoss().after, 20)
  check('third loss backs off again', p.afterLoss().after, 30)
  check('the schedule is not endless', p.afterLoss(), { act: 'give-up' })
  check('and stays given up', p.afterLoss(), { act: 'give-up' })
}

console.log('[reconnect] the operator overrules recovery')
{
  const p = fresh()
  p.opening(DETAILS)
  p.established()
  p.abandoned()
  check('hanging up is not a fault to recover from', p.afterLoss(), { act: 'stand-down', why: 'hung-up' })
}
{
  const p = fresh()
  p.opening(DETAILS)
  p.established()
  p.afterLoss()
  p.opening({ method: 'ap' })
  check('reconnecting to different details starts unproven', p.afterLoss(), {
    act: 'stand-down',
    why: 'never-worked',
  })
}

console.log('[reconnect] recovery in progress')
{
  const p = fresh()
  p.opening(DETAILS)
  p.established()
  p.afterLoss()
  p.reopening()
  check('a retry does not reset the attempt count it belongs to', p.afterLoss().after, 20)
}
{
  const p = fresh()
  p.opening(DETAILS)
  p.established()
  p.afterLoss()
  p.afterLoss()
  p.reopening()
  p.established()
  check('getting back up spends the earlier failures', p.afterLoss().after, 10)
}
{
  // The case that matters most: recovery must never fight a deliberate hang-up,
  // even when the operator hangs up while an attempt is already scheduled.
  const p = fresh()
  p.opening(DETAILS)
  p.established()
  p.afterLoss()
  p.abandoned()
  check('hanging up mid-recovery stops it', p.afterLoss(), { act: 'stand-down', why: 'hung-up' })
}

finish()

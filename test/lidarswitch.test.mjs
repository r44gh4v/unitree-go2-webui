// Whether the lidar-off switch needs to send OFF again. Pure policy, no robot.
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const modPath = path.join(here, '..', 'src', 'lib', 'lidarSwitch.ts')
const { shouldReassertOff, REASSERT_SCHEDULE_MS } = await import('file://' + modPath.replace(/\\/g, '/'))

import { makeChecker } from './harness.mjs'
const { check, finish } = makeChecker()

console.log('[lidarswitch] the operator has not asked for off')
{
  check('never reassert while on is desired', shouldReassertOff({ desiredOff: false, elapsedMs: 999999, sentCount: 0 }), false)
}

console.log('[lidarswitch] before the first threshold')
{
  check('too soon to resend', shouldReassertOff({ desiredOff: true, elapsedMs: 500, sentCount: 0 }), false)
  check('right at the edge, not yet', shouldReassertOff({ desiredOff: true, elapsedMs: REASSERT_SCHEDULE_MS[0] - 1, sentCount: 0 }), false)
}

console.log('[lidarswitch] at and past each threshold')
{
  check('exactly at the first threshold', shouldReassertOff({ desiredOff: true, elapsedMs: REASSERT_SCHEDULE_MS[0], sentCount: 0 }), true)
  check('past the first threshold', shouldReassertOff({ desiredOff: true, elapsedMs: REASSERT_SCHEDULE_MS[0] + 500, sentCount: 0 }), true)
  check('already sent once, before the second threshold', shouldReassertOff({ desiredOff: true, elapsedMs: REASSERT_SCHEDULE_MS[0] + 500, sentCount: 1 }), false)
  check('at the second threshold', shouldReassertOff({ desiredOff: true, elapsedMs: REASSERT_SCHEDULE_MS[1], sentCount: 1 }), true)
  check('at the third threshold', shouldReassertOff({ desiredOff: true, elapsedMs: REASSERT_SCHEDULE_MS[2], sentCount: 2 }), true)
}

console.log('[lidarswitch] the schedule is not endless')
{
  check('schedule exhausted stops resending', shouldReassertOff({ desiredOff: true, elapsedMs: 999999, sentCount: REASSERT_SCHEDULE_MS.length }), false)
}

finish()

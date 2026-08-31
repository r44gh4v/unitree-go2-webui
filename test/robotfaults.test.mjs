// Turning the robot's fault frames into something an operator can read.
//
// Faults arrive in two shapes - a single row, or a batch of them - across three
// frame types, one of which means "this one has cleared". Getting the shape
// wrong loses a fault silently, which is the worst way to lose one: the console
// looks calm while the robot is reporting a problem.
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const modPath = path.join(here, '..', 'src', 'lib', 'robotFaults.ts')
const { parseFaultFrame, FAULT_LIMIT } = await import('file://' + modPath.replace(/\\/g, '/'))

import { makeChecker } from './harness.mjs'
const { check, finish } = makeChecker()

// [unix seconds, source, code]
const ROW = [1700000000, 300, 0x80]
const OTHER = [1700000001, 301, 0x01]

console.log('[robotfaults] the shapes a frame arrives in')
{
  const out = parseFaultFrame('add_error', ROW)
  check('a single row yields one fault', out.length, 1)
  check('the timestamp becomes milliseconds', out[0].ts, 1700000000000)
  check('the source is named, not a number', typeof out[0].source, 'string')
  check('the code is described', out[0].text.length > 0, true)
}
{
  const out = parseFaultFrame('errors', [ROW, OTHER])
  check('a batch yields one fault per row', out.length, 2)
  check('order is preserved', out[0].ts < out[1].ts, true)
}
{
  // A batch of one is still a batch, and must not be read as a single row of
  // three numbers - the outer array is the tell.
  check('a batch of one is not mistaken for a row', parseFaultFrame('errors', [ROW]).length, 1)
}

console.log('[robotfaults] cleared faults')
{
  check('add_error is live', parseFaultFrame('add_error', ROW)[0].cleared, false)
  check('errors is live', parseFaultFrame('errors', [ROW])[0].cleared, false)
  // rm_error is the robot saying a fault has gone. It still arrives as a fault,
  // marked cleared, so the list can show what stopped rather than silently
  // dropping the row and leaving the operator to notice a count change.
  check('rm_error is cleared', parseFaultFrame('rm_error', ROW)[0].cleared, true)
}

console.log('[robotfaults] frames that carry nothing usable')
{
  check('an empty batch', parseFaultFrame('errors', []), [])
  check('null', parseFaultFrame('errors', null), [])
  check('undefined', parseFaultFrame('errors', undefined), [])
  check('a string', parseFaultFrame('errors', 'oh no'), [])
  check('a number', parseFaultFrame('errors', 42), [])
  check('an object', parseFaultFrame('errors', { code: 1 }), [])
}
{
  // A row must carry timestamp, source and code. A short one is not a fault
  // with defaults, it is a frame we do not understand.
  check('a row too short is skipped', parseFaultFrame('add_error', [1700000000, 300]), [])
  check('a row of nothing', parseFaultFrame('add_error', []), [])
  check('a batch with one bad row keeps the good one', parseFaultFrame('errors', [ROW, [1, 2]]).length, 1)
  check('a batch of only bad rows', parseFaultFrame('errors', [[1, 2], null]), [])
}

console.log('[robotfaults] how many are kept')
{
  check('the cap is a number', typeof FAULT_LIMIT, 'number')
  check('and is not so small it hides a burst', FAULT_LIMIT >= 50, true)
}

finish()

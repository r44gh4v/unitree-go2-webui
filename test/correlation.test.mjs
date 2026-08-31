// Request correlation ids.
//
// Every api call to the robot is matched to its reply purely on this number.
// Two live requests sharing one means the console resolves the wrong promise,
// so uniqueness within a session is not a nice-to-have.
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const modPath = path.join(here, '..', 'src', 'lib', 'correlation.ts')
const { nextRequestId } = await import('file://' + modPath.replace(/\\/g, '/'))

import { makeChecker } from './harness.mjs'
const { check, finish } = makeChecker()

console.log('[correlation] ids are unique')
{
  // The old implementation was (Date.now() % 2^31) + random(0..999). Every id
  // minted inside one millisecond drew from the same thousand values, so a
  // burst collided at roughly the birthday bound - a handful of calls in one
  // tick is already a percent-level chance. This loop reproduces that burst.
  const seen = new Set()
  let collisions = 0
  for (let i = 0; i < 100000; i++) {
    const id = nextRequestId()
    if (seen.has(id)) collisions++
    seen.add(id)
  }
  check('a hundred thousand ids in a tight burst never repeat', collisions, 0)
}
{
  const a = nextRequestId()
  const b = nextRequestId()
  check('successive ids differ', a === b, false)
}
{
  const id = nextRequestId()
  check('an id is a number', typeof id, 'number')
  check('an id is a positive integer', Number.isInteger(id) && id > 0, true)
  // The robot echoes the id back inside JSON. Staying inside int32 keeps it in
  // the range the firmware and the reference implementations use.
  check('an id fits in a signed 32-bit int', id <= 2147483647, true)
}
{
  const ids = []
  for (let i = 0; i < 1000; i++) ids.push(nextRequestId())
  const ascending = ids.every((v, i) => i === 0 || v > ids[i - 1])
  check('ids ascend, so a stale reply is recognisable', ascending, true)
}

finish()

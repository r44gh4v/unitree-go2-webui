// The action table.
//
// Every tile in the Actions grid comes from here, and so does the shape of the
// request that reaches the robot. Two facts used to live away from the table -
// which actions clear every other tile, and which one is pose - as a name set
// and a string comparison inside the panel. A typo in either failed silently.
//
// The expected kinds below were captured from the table as it behaved before
// `kind` existed, so this doubles as a regression guard: if a refactor changes
// what any tile does, or what parameter shape goes on the wire, it fails here.
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const modPath = path.join(here, '..', 'src', 'lib', 'actionKinds.ts')
const { KINDS, clearsEverything, isExclusive, sendsToggleData } = await import(
  'file://' + modPath.replace(/\\/g, '/')
)

import { makeChecker } from './harness.mjs'
const { check, finish } = makeChecker()

/** [name, kind, sends {data: bool} on the wire] as the table behaved before. */
const EXPECTED = [
  ['RecoveryStand', 'settles', false], ['StandDown', 'settles', false], ['Sit', 'settles', false],
  ['RiseSit', 'oneShot', false], ['Damp', 'settles', false], ['StopMove', 'settles', false],
  ['ClassicWalk', 'gait', true], ['StaticWalk', 'gait', true], ['FreeWalk', 'gait', true],
  ['TrotRun', 'gait', true], ['RageMode', 'gait', true], ['WalkStair', 'gait', true],
  ['CrossStep', 'gait', true], ['FreeBound', 'gait', true], ['FreeJump', 'gait', true],
  ['EconomicGait', 'latching', true], ['ContinuousGait', 'latching', true],
  ['Hello', 'oneShot', false], ['Stretch', 'oneShot', false], ['FingerHeart', 'oneShot', false],
  ['Scrape', 'oneShot', false], ['Dance1', 'oneShot', false], ['Dance2', 'oneShot', false],
  ['FrontJump', 'oneShot', false], ['FrontPounce', 'oneShot', false], ['FrontFlip', 'oneShot', false],
  ['BackFlip', 'oneShot', false], ['LeftFlip', 'oneShot', false],
  ['Handstand', 'latching', true], ['BackStand', 'latching', true],
  ['LeadFollow', 'latching', true], ['FreeAvoid', 'latching', true],
  ['Pose', 'pose', true],
]

console.log('[actions] the kinds themselves')
{
  check('every kind is spelled once', [...new Set(KINDS)].length, KINDS.length)
  check('the kinds are the five the panel handles', [...KINDS].sort(), [
    'gait', 'latching', 'oneShot', 'pose', 'settles',
  ])
}

console.log('[actions] what each kind means')
{
  // A settling action puts the robot back to standing or resting, which ends
  // whatever else was running - so every lit tile has to go out with it.
  check('settling clears every other tile', clearsEverything('settles'), true)
  check('pose does not clear the grid', clearsEverything('pose'), false)
  check('a gait does not clear the grid', clearsEverything('gait'), false)
  check('a one-shot does not clear the grid', clearsEverything('oneShot'), false)
  check('a latching action does not clear the grid', clearsEverything('latching'), false)
}
{
  // The robot only walks one way at a time, so lighting one gait releases the
  // others. A latching action is not a gait and coexists with them.
  check('gaits replace one another', isExclusive('gait'), true)
  check('latching actions do not', isExclusive('latching'), false)
  check('one-shots do not', isExclusive('oneShot'), false)
}
{
  // This decides the request that reaches the robot: a toggling action takes
  // {data: true|false}, everything else takes its own parameter.
  check('a gait sends toggle data', sendsToggleData('gait'), true)
  check('a latching action sends toggle data', sendsToggleData('latching'), true)
  check('pose sends toggle data', sendsToggleData('pose'), true)
  check('a one-shot does not', sendsToggleData('oneShot'), false)
  check('a settling action does not', sendsToggleData('settles'), false)
}

console.log('[actions] the table has not drifted')
{
  const constPath = path.join(here, '..', 'src', 'lib', 'constants.ts')
  const { ACTIONS } = await import('file://' + constPath.replace(/\\/g, '/'))

  check('every action still present', ACTIONS.length, EXPECTED.length)
  check('names and order unchanged', ACTIONS.map((a) => a.name), EXPECTED.map((e) => e[0]))

  const wrongKind = ACTIONS.filter((a, i) => a.kind !== EXPECTED[i][1]).map((a) => `${a.name}:${a.kind}`)
  check('every action kept its kind', wrongKind, [])

  const wrongWire = ACTIONS.filter((a, i) => sendsToggleData(a.kind) !== EXPECTED[i][2]).map((a) => a.name)
  check('every action kept its parameter shape', wrongWire, [])

  check('no action is missing a kind', ACTIONS.filter((a) => !KINDS.includes(a.kind)).map((a) => a.name), [])
  check('no duplicate names', ACTIONS.length - new Set(ACTIONS.map((a) => a.name)).size, 0)
  check('every action has at least one api id', ACTIONS.filter((a) => !Object.keys(a.ids ?? {}).length).map((a) => a.name), [])
  check('every action has a group', ACTIONS.filter((a) => !a.group).map((a) => a.name), [])
}

finish()

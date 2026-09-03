// How the Actions grid decides what a tile shows. The policy used to be split
// between the panel's branches and motionState.ts; these cases pin it in one
// place: what this console just did (pressed, refused) outranks telemetry, and
// telemetry outranks optimism - except for the tiles it can never confirm.
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const modPath = path.join(here, '..', 'src', 'lib', 'actionPhases.ts')
const { freshGrid, reduce, tilePhase } = await import('file://' + modPath.replace(/\\/g, '/'))

import { makeChecker } from './harness.mjs'
const { check, finish } = makeChecker()

console.log('[actionphases] a press is pending until the robot answers')
{
  const s = reduce(freshGrid(), { kind: 'pressed', name: 'Hello' })
  check('pressed shows pending', tilePhase(s, 'Hello'), 'pending')
}

console.log('[actionphases] a refusal is shown, explained, and fades')
{
  let s = reduce(freshGrid(), { kind: 'pressed', name: 'FrontFlip' })
  s = reduce(s, { kind: 'refused', name: 'FrontFlip', message: 'Robot refused the command (status 7004)' })
  check('refusal shows failed', tilePhase(s, 'FrontFlip'), 'failed')
  check('the reason is kept for the tooltip', s.reason.FrontFlip, 'Robot refused the command (status 7004)')
  s = reduce(s, { kind: 'faded', name: 'FrontFlip' })
  check('a faded refusal returns to idle', tilePhase(s, 'FrontFlip'), 'idle')
}
{
  const s = reduce(freshGrid(), { kind: 'refused', name: 'BackFlip', message: 'refused (status 4206)' })
  check('a wrong-posture refusal gains the stand-up hint', s.reason.BackFlip, 'refused (status 4206) Try Stand up first.')
}
{
  // A stale fade timer must not knock out a fresh press.
  let s = reduce(freshGrid(), { kind: 'pressed', name: 'Hello' })
  s = reduce(s, { kind: 'faded', name: 'Hello' })
  check('faded only fades a failure', tilePhase(s, 'Hello'), 'pending')
}

console.log('[actionphases] what an accepted action leaves lit')
{
  const s = reduce(reduce(freshGrid(), { kind: 'pressed', name: 'Hello' }), { kind: 'accepted', name: 'Hello', on: true })
  check('a one-shot goes back to idle', tilePhase(s, 'Hello'), 'idle')
}
{
  const s = reduce(freshGrid(), { kind: 'accepted', name: 'StaticWalk', on: true })
  check('a gait telemetry cannot confirm stays lit on trust', tilePhase(s, 'StaticWalk'), 'on')
}
{
  let s = reduce(freshGrid(), { kind: 'accepted', name: 'StaticWalk', on: true })
  s = reduce(s, { kind: 'accepted', name: 'FreeWalk', on: true })
  check('lighting one gait releases the others', tilePhase(s, 'StaticWalk'), 'idle')
  check('a gait telemetry can confirm waits for telemetry', tilePhase(s, 'FreeWalk'), 'idle')
}
{
  const s = reduce(freshGrid(), { kind: 'accepted', name: 'Handstand', on: true })
  check('a tracked latching action is never lit from optimism', tilePhase(s, 'Handstand'), 'idle')
}
{
  let s = reduce(freshGrid(), { kind: 'accepted', name: 'StaticWalk', on: true })
  s = reduce(s, { kind: 'accepted', name: 'RecoveryStand', on: true })
  check('settling the robot puts every tile out', tilePhase(s, 'StaticWalk'), 'idle')
}

console.log('[actionphases] telemetry lights what the robot reports')
{
  const s = reduce(freshGrid(), { kind: 'report', state: { mode: 9 }, motionMode: 'normal' })
  check('legacy free walk engages its tile', tilePhase(s, 'FreeWalk'), 'on')
  check('nothing else lights with it', tilePhase(s, 'Handstand'), 'idle')
}
{
  let s = reduce(freshGrid(), { kind: 'report', state: { error_code: 2011 }, motionMode: 'mcf' })
  check('mcf handstand engages its tile', tilePhase(s, 'Handstand'), 'on')
  s = reduce(s, { kind: 'report', state: { error_code: 1013 }, motionMode: 'mcf' })
  check('mcf persists the mode across a balance-stand frame', tilePhase(s, 'Handstand'), 'on')
}
{
  const a = reduce(freshGrid(), { kind: 'report', state: { mode: 9 }, motionMode: 'normal' })
  const b = reduce(a, { kind: 'report', state: { mode: 9 }, motionMode: 'normal' })
  check('an unchanged report returns the same state object', a === b, true)
}
{
  let s = reduce(freshGrid(), { kind: 'report', state: { mode: 9 }, motionMode: 'normal' })
  s = reduce(s, { kind: 'pressed', name: 'FreeWalk' })
  check('what the operator just did outranks telemetry', tilePhase(s, 'FreeWalk'), 'pending')
}

finish()

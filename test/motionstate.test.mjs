// Decoding sportmodestate into a tile name, per lib/motionState.ts. Both wire
// shapes (legacy enum+bitfield, mcf full mode code) get their own cases.
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const modPath = path.join(here, '..', 'src', 'lib', 'motionState.ts')
const { decodeLegacyState, decodeMcfState, decodeMotionState, actionNameFor } = await import(
  'file://' + modPath.replace(/\\/g, '/')
)

import { makeChecker } from './harness.mjs'
const { check, finish } = makeChecker()

console.log('[motionstate] legacy: mode 0 is always balanceStand')
{
  check('mode 0 with no other fields', decodeLegacyState({}), 'balanceStand')
  check('mode 0 explicit', decodeLegacyState({ mode: 0, gait_type: 1 }), 'balanceStand')
}

console.log('[motionstate] legacy: mode enum, unambiguous states')
{
  check('freeBound', decodeLegacyState({ mode: 15 }), 'freeBound')
  check('freeJump', decodeLegacyState({ mode: 16 }), 'freeJump')
  check('freeAvoid', decodeLegacyState({ mode: 17 }), 'freeAvoid')
  check('stair by mode', decodeLegacyState({ mode: 18 }), 'stair')
  check('crossStep', decodeLegacyState({ mode: 20 }), 'crossStep')
  check('damping stays damping even under locomotion gait', decodeLegacyState({ mode: 7, gait_type: 1 }), 'damping')
  check('jointLock stays jointLock', decodeLegacyState({ mode: 6, gait_type: 2 }), 'jointLock')
}

console.log('[motionstate] legacy: error_code bitfield wins over the mode enum')
{
  // bit 1: standOut
  check('standOut bit', decodeLegacyState({ mode: 1, error_code: 0b10 }), 'standOut')
  // bit 4: batteryLife
  check('batteryLife bit', decodeLegacyState({ mode: 1, error_code: 0b10000 }), 'batteryLife')
  // bit 5: leadFollow
  check('leadFollow bit', decodeLegacyState({ mode: 1, error_code: 0b100000 }), 'leadFollow')
}

console.log('[motionstate] legacy: locomotion composes with continuousGait (bit 0)')
{
  check('plain walk', decodeLegacyState({ mode: 3, gait_type: 1 }), 'walk')
  check('continuous walk', decodeLegacyState({ mode: 3, gait_type: 1, error_code: 1 }), 'continuousWalk')
  check('plain run', decodeLegacyState({ mode: 3, gait_type: 2 }), 'run')
  check('continuous run', decodeLegacyState({ mode: 3, gait_type: 2, error_code: 1 }), 'continuousRun')
  check('stair by gait under locomotion', decodeLegacyState({ mode: 3, gait_type: 3 }), 'stair')
  check('downStair by gait', decodeLegacyState({ mode: 3, gait_type: 4 }), 'downStair')
}

console.log('[motionstate] mcf: error_code is a full mode code')
{
  check('0 is freeWalk', decodeMcfState(0, 'balanceStand').state, 'freeWalk')
  check('freeAvoid code', decodeMcfState(2007, 'freeWalk').state, 'freeAvoid')
  check('freeBound code', decodeMcfState(2008, 'freeWalk').state, 'freeBound')
  check('freeJump code', decodeMcfState(2009, 'freeWalk').state, 'freeJump')
  check('handStand code', decodeMcfState(2011, 'freeWalk').state, 'handStand')
  check('leadFollow code', decodeMcfState(2019, 'freeWalk').state, 'leadFollow')
  check('rageMode code', decodeMcfState(2021, 'freeWalk').state, 'rageMode')
  check('batteryLife code', decodeMcfState(1017, 'freeWalk').state, 'batteryLife')
}

console.log('[motionstate] mcf: BalanceStand-ish frames persist the last real mode')
{
  const first = decodeMcfState(2008, 'freeWalk')
  check('freeBound becomes the new last state', first.lastState, 'freeBound')
  const idle = decodeMcfState(0, first.lastState)
  check('a freeWalk (idle) frame does not clear the highlight', idle.state, 'freeWalk')
  const balanceStand = decodeMcfState(1013, first.lastState)
  check('a bare BalanceStand frame keeps showing the chosen gait', balanceStand.state, 'freeBound')
  check('lastState is unchanged by a BalanceStand frame', balanceStand.lastState, 'freeBound')
  const hello = decodeMcfState(1006, first.lastState)
  check('hello also resets to freeWalk, not held', hello.state, 'freeWalk')
}

console.log('[motionstate] the dispatcher picks the wire shape from the running service')
{
  const mcf = decodeMotionState({ error_code: 2007 }, 'mcf')
  check('mcf dispatches to the error_code decoder', mcf.state, 'freeAvoid')
  const legacy = decodeMotionState({ mode: 17 }, 'normal')
  check('normal dispatches to the mode decoder', legacy.state, 'freeAvoid')
  check('non-mcf never touches mcfLastState', legacy.mcfLastState, 'freeWalk')
}

console.log('[motionstate] state to tile name')
{
  check('freeAvoid lights the FreeAvoid tile', actionNameFor('freeAvoid'), 'FreeAvoid')
  check('handStand lights the Handstand tile', actionNameFor('handStand'), 'Handstand')
  check('continuousWalk lights March', actionNameFor('continuousWalk'), 'ContinuousGait')
  check('a plain walk lights nothing - which of our gait tiles produced it is not known', actionNameFor('walk'), null)
  check('balanceStand lights nothing', actionNameFor('balanceStand'), null)
  check('an unrecognised state lights nothing', actionNameFor('something-new'), null)
}

finish()

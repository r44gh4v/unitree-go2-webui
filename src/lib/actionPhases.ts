// What each Actions tile shows, decided in one place.
//
// The policy used to live on both sides of a seam: motionState.ts decoded what
// telemetry confirms, while the optimism rules - which tiles may stay lit on a
// successful send, how lighting one gait releases the others, what a settling
// action clears - sat as branches inside the panel's click handler, untested.
// A mode that engaged silently once looked identical to one that never fired,
// and the fix went into the panel, where nothing could pin it down.
//
// The rule, stated once: what the operator just did (pending, refused) outranks
// telemetry, telemetry outranks optimism, and optimism is allowed only for the
// tiles telemetry can never confirm. Everything the grid asks is one lookup.
//
// Imports only other test-loadable modules, with extensions, so node runs this
// straight from source - see CLAUDE.md's testing constraints.

import { ACTIONS } from './constants.ts'
import { clearsEverything, isExclusive, staysLit } from './actionKinds.ts'
import { actionNameFor, decodeMotionState, TRACKED_ACTION_NAMES, type SportModeSnapshot } from './motionState.ts'

export type Phase = 'idle' | 'pending' | 'on' | 'failed'

export interface GridState {
  /** What this console just did, per tile: pending, failed, or optimistic on. */
  phase: Record<string, Phase>
  /** Why a refused tile was refused, kept for its tooltip. */
  reason: Record<string, string>
  /** The tile telemetry confirms is engaged, or null. */
  engaged: string | null
  /** mcf reports the last real mode across idle frames; threaded per frame. */
  mcfLastState: string
}

export type GridEvent =
  | { kind: 'pressed'; name: string }
  | { kind: 'accepted'; name: string; on: boolean }
  | { kind: 'refused'; name: string; message: string }
  /** A refusal has been shown long enough; the panel's timer sends this. */
  | { kind: 'faded'; name: string }
  | { kind: 'report'; state: SportModeSnapshot; motionMode: string }

const KIND_OF = new Map(ACTIONS.map((a) => [a.name, a.kind]))

export function freshGrid(): GridState {
  return { phase: {}, reason: {}, engaged: null, mcfLastState: 'freeWalk' }
}

export function reduce(s: GridState, e: GridEvent): GridState {
  switch (e.kind) {
    case 'pressed':
      return { ...s, phase: { ...s.phase, [e.name]: 'pending' } }

    case 'refused': {
      // 4206 is the robot saying the posture is wrong for this move, which is
      // almost always cured by standing up first - say so rather than echoing.
      const hint = e.message.includes('4206') ? `${e.message} Try Stand up first.` : e.message
      return { ...s, phase: { ...s.phase, [e.name]: 'failed' }, reason: { ...s.reason, [e.name]: hint } }
    }

    case 'faded':
      // Only a failure fades. A stale timer must not knock out a fresh press.
      if (s.phase[e.name] !== 'failed') return s
      return { ...s, phase: { ...s.phase, [e.name]: 'idle' } }

    case 'accepted': {
      const kind = KIND_OF.get(e.name)
      if (!kind) return s
      if (clearsEverything(kind)) {
        // Back to standing or resting: nothing is running any more, so no
        // tile should still claim to be. Telemetry keeps `engaged` honest.
        return { ...s, phase: {} }
      }
      if (isExclusive(kind) && e.on) {
        // The robot walks one way at a time, so lighting a gait releases the
        // others rather than leaving two lit. Every other exclusive tile's
        // optimism is cleared unconditionally - telemetry may have nothing to
        // say about the gait that just stopped, so nothing else will.
        const phase = { ...s.phase }
        for (const other of ACTIONS) {
          if (isExclusive(other.kind) && other.name !== e.name) phase[other.name] = 'idle'
        }
        // Telemetry is authority for the gaits it can identify; only the
        // tiles it cannot confirm are allowed to stay lit on trust.
        phase[e.name] = TRACKED_ACTION_NAMES.has(e.name) ? 'idle' : 'on'
        return { ...s, phase }
      }
      const showOn = staysLit(kind) && e.on && !TRACKED_ACTION_NAMES.has(e.name)
      return { ...s, phase: { ...s.phase, [e.name]: showOn ? 'on' : 'idle' } }
    }

    case 'report': {
      const { state, mcfLastState } = decodeMotionState(e.state, e.motionMode, s.mcfLastState)
      const engaged = actionNameFor(state)
      // Telemetry arrives many times a second; an unchanged report must not
      // produce a new object, or every frame re-renders the whole grid.
      if (engaged === s.engaged && mcfLastState === s.mcfLastState) return s
      return { ...s, engaged, mcfLastState }
    }
  }
}

/** What the tile for `name` shows right now. Pose is the panel's own case -
 *  its state is shared with the drive loop and lives in the context. */
export function tilePhase(s: GridState, name: string): Phase {
  const p = s.phase[name]
  if (p === 'pending' || p === 'failed') return p
  if (s.engaged === name || p === 'on') return 'on'
  return 'idle'
}

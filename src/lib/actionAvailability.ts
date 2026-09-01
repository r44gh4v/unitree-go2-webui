// Whether an action can be sent, and what to say about it.
//
// The same action has a different api id on each motion service, and our tables
// are transcriptions rather than the robot's own manifest. So an action missing
// from the running service may genuinely not exist there, or may simply be
// missing from our notes - and there is no way to tell from here.
//
// The console therefore does not refuse. It sends the id it has and lets the
// robot answer, because "API not registered" from the robot is a better outcome
// than a button the console greyed out on a guess. That policy used to be
// reassembled at every tile from a raw id, a boolean and a service name; it is
// one question with one answer now.

import type { ActionSpec, MotionMode } from './constants.ts'

/**
 * Which service to borrow from when the running one has no entry, per family.
 *
 * mcf ids only exist on the unified service - sending one to a robot running
 * normal/ai/advanced is asking for a command id that is definitionally not on
 * that service's manifest, worse than borrowing from a sibling legacy service
 * that at least shares an id space. So a legacy robot borrows from the other
 * two legacy services first, and only reaches for mcf as a last resort; an mcf
 * robot has no legacy siblings to prefer and goes straight to legacy.
 */
const BORROW_ORDER: Record<MotionMode, MotionMode[]> = {
  mcf: ['normal', 'ai', 'advanced'],
  normal: ['ai', 'advanced', 'mcf'],
  ai: ['advanced', 'normal', 'mcf'],
  advanced: ['ai', 'normal', 'mcf'],
}

export type Standing =
  /** The running service lists this action. */
  | 'listed'
  /** Another service lists it; we are sending that id and hoping. */
  | 'borrowed'
  /** No service we know of lists it. */
  | 'unknown'

export interface Availability {
  apiId: number | null
  standing: Standing
  /** Can the tile be pressed at all? */
  usable: boolean
  /** Should the tile say it might not work? */
  untested: boolean
  /** Which service the id came from, when it was borrowed. */
  borrowedFrom: MotionMode | null
  /** What to tell the operator, or null when there is nothing to explain. */
  why: string | null
}

/** Decide how an action stands against the motion service the robot is running. */
export function resolveAction(action: ActionSpec, running: MotionMode): Availability {
  const exact = action.ids[running]
  if (exact !== undefined) {
    return { apiId: exact, standing: 'listed', usable: true, untested: false, borrowedFrom: null, why: null }
  }

  for (const mode of BORROW_ORDER[running]) {
    const id = action.ids[mode]
    if (id === undefined) continue
    return {
      apiId: id,
      standing: 'borrowed',
      usable: true,
      untested: true,
      borrowedFrom: mode,
      why: `The ${running} service does not list this. Sends the ${mode} id, and the robot may refuse it.`,
    }
  }

  return {
    apiId: null,
    standing: 'unknown',
    usable: false,
    untested: false,
    borrowedFrom: null,
    why: 'No command id is known for this action.',
  }
}

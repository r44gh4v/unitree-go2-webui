// What an action does to the grid and to the wire.
//
// An action has a shape: some are momentary, some settle the robot, some
// replace each other. Those facts used to be scattered - two optional booleans
// on the spec, a set of five names held in the panel, and a string comparison
// for pose - so the panel had to reassemble the shape at every call site, and a
// typo in the name set failed silently.
//
// One `kind` on the action carries all of it, and these three questions are the
// only things anyone needs to ask about it.

export const KINDS = ['oneShot', 'settles', 'gait', 'latching', 'pose'] as const

export type ActionKind = (typeof KINDS)[number]

/**
 * oneShot   a momentary move - a jump, a greeting. Runs and is over.
 * settles   puts the robot back to standing or resting, which ends whatever
 *           else was running, so every lit tile goes out with it.
 * gait      a walking style. The robot walks one way at a time, so lighting
 *           one releases the others.
 * latching  stays on until pressed again, and coexists with a gait.
 * pose      the robot holds a posture while the sticks lean the body. Shares
 *           its state with the drive loop, so it is its own kind.
 */

/** Does turning this on put every other tile out? */
export function clearsEverything(kind: ActionKind): boolean {
  return kind === 'settles'
}

/** Does turning this on release the others of its sort? */
export function isExclusive(kind: ActionKind): boolean {
  return kind === 'gait'
}

/**
 * Does the robot expect {data: true|false} rather than the action's own
 * parameter? This decides what actually goes on the wire.
 */
export function sendsToggleData(kind: ActionKind): boolean {
  return kind === 'gait' || kind === 'latching' || kind === 'pose'
}

/** Does the tile stay lit after a successful press? */
export function staysLit(kind: ActionKind): boolean {
  return kind === 'gait' || kind === 'latching' || kind === 'pose'
}

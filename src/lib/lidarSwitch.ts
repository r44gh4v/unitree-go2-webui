// Whether the lidar-off switch needs to say OFF again.
//
// Turning the lidar off is not one message and done: the obstacle-avoidance
// service restarts it if its own disable was not acknowledged in time, so a
// console that sends OFF once and believes it is finished gets the sensor back
// a few seconds later, invisibly. This is the whole policy - given how long ago
// the operator asked for OFF, and how many times it has already been resent,
// decide whether to send it again.
//
// Deliberately not gated on a reported lidar-on/off field. rt/utlidar/lidar_state
// has not been confirmed trustworthy on hardware, and gating a real re-assert on
// an unverified field risks skipping it when the sensor is in fact still
// spinning - worse than a redundant resend. This file imports nothing, so node
// loads it straight from source for the tests.

/**
 * Offsets, in ms since OFF was asked for, at which another OFF is sent. Short
 * intervals first: the avoidance service usually restarts the lidar within a
 * couple of seconds of losing it, if it is going to at all.
 */
export const REASSERT_SCHEDULE_MS = [1000, 3000, 6000]

export interface ReassertState {
  /** true once the operator has asked for the lidar to be off. */
  desiredOff: boolean
  /** milliseconds since desiredOff last became true. */
  elapsedMs: number
  /** how many reassert sends have already gone out for this off request. */
  sentCount: number
}

/** Should another OFF be sent right now? */
export function shouldReassertOff(s: ReassertState): boolean {
  if (!s.desiredOff) return false
  if (s.sentCount >= REASSERT_SCHEDULE_MS.length) return false
  return s.elapsedMs >= REASSERT_SCHEDULE_MS[s.sentCount]
}

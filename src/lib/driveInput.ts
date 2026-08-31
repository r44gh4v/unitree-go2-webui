// What the operator is asking the robot to do.
//
// Three inputs can be live at once - a pointer on the dial, keys held down, a
// gamepad - and combining them decides what a 15kg machine does. The rules used
// to exist only as statements inside a 20Hz loop, so the only way to check one
// was to drive a real robot and watch it. They are stated here instead, where
// they can be read in one place and tested.
//
// Everything in this file is pure: inputs in, a demand out. The ramping, the
// sending and the pose branch stay in the loop, because those are about time
// and this is not.

export interface DriveVector {
  x: number
  y: number
  z: number
}

/** A resting stick reports small values forever; below this it means rest. */
export const DEADZONE = 0.12

/**
 * Per-tick slew, as a fraction of full travel. A key goes from nothing to fully
 * pressed instantly, asking the gait controller for a step change no physical
 * stick could produce - the robot lurches catching up. Rising is smoothed;
 * falling is not, because letting go must never trail the key.
 */
export const RAMP_UP = 0.5
export const RAMP_DOWN = 1

export interface DriveInputs {
  /** The on-screen dial, already in robot axes. */
  stick: DriveVector
  /** Keys currently held, lower-cased. */
  keys: ReadonlySet<string>
  /** The live gamepad, or null when none is connected. */
  pad: { axes: readonly number[] } | null
}

const ZERO: DriveVector = { x: 0, y: 0, z: 0 }

/** Ignore the drift a resting stick always reports. */
const past = (v: number) => (Math.abs(v) < DEADZONE ? 0 : v)

/**
 * Combine every live input into one demand, before ramping.
 *
 * Precedence runs pointer, then keys, then gamepad, each overriding the last
 * where it has something to say. The gamepad comes last because picking one up
 * is the clearest statement of intent available.
 */
export function demandFrom({ stick, keys, pad }: DriveInputs): DriveVector {
  let { x, y, z } = stick

  // A held key is a full-travel demand in that direction. Holding both ends of
  // an axis is a contradiction and the later rule simply wins, which is at
  // least deterministic - cancelling to zero would be a surprise mid-stride.
  if (keys.has('w') || keys.has('arrowup')) y = 1
  if (keys.has('s') || keys.has('arrowdown')) y = -1
  if (keys.has('a')) x = -1
  if (keys.has('d')) x = 1
  if (keys.has('q') || keys.has('arrowleft')) z = 1
  if (keys.has('e') || keys.has('arrowright')) z = -1

  if (pad) {
    const gx = past(pad.axes[0] ?? 0)
    // Pushed away from the operator is forward, so this axis reads inverted.
    const gy = past(-(pad.axes[1] ?? 0))
    const gz = past(-(pad.axes[2] ?? 0))
    // The left stick is one control: deflecting it replaces the whole
    // translation demand rather than merging axis by axis, or a nudge sideways
    // would leave a held W contributing forward motion nobody asked for.
    if (gx || gy) {
      x = gx
      y = gy
    }
    // Turning is a separate control, so a resting right stick leaves q/e alone.
    if (gz) z = gz
  }

  // Hold translation inside the unit circle. W and D together asked for 1.41x
  // the straight-line speed, which on its own was enough to make a diagonal
  // walk look unsteady. Turning is its own axis and is not part of this.
  const magnitude = Math.hypot(x, y)
  if (magnitude > 1) {
    x /= magnitude
    y /= magnitude
  }

  return { x, y, z }
}

/** Step one axis toward its demand, no faster than the ramp allows. */
export function approach(current: number, target: number): number {
  const rate = Math.abs(target) > Math.abs(current) ? RAMP_UP : RAMP_DOWN
  const delta = target - current
  if (Math.abs(delta) <= rate) return target
  return current + Math.sign(delta) * rate
}

export const REST = ZERO

import { useCallback, useEffect, useRef, useState } from 'react'
import { isTextEntry } from '../lib/focus'
import { useRobot } from '../state/RobotContext'

const SEND_HZ = 20
const SEND_MS = 1000 / SEND_HZ
/** Keep sending zeros briefly after release so the robot reliably settles. */
const TRAILING_ZEROS = 4

/**
 * Per-tick slew limits, as a fraction of full stick. A key goes from nothing to
 * fully pressed instantly, which asks the gait controller for a step change in
 * velocity that no physical stick could ever produce - the robot lurches
 * catching up. A little smoothing takes the edge off that, but at 0.15 it also
 * cost 300ms before the robot moved at all, which felt like lag. At 0.5 the
 * stick reaches full travel in two ticks - 100ms - and release is instant,
 * because letting go must never trail the key.
 */
const RAMP_UP = 0.5
const RAMP_DOWN = 1

/** Below this a command is treated as rest. */
const EPSILON = 0.004

export interface DriveVector {
  x: number
  y: number
  z: number
}

export interface DriveLimits {
  /** how far a full input deflects the stick, 0..1 */
  linear: number
  /** how far a full turn input deflects the stick, 0..1 */
  angular: number
}

const ZERO: DriveVector = { x: 0, y: 0, z: 0 }

/** Stick deflection is normalised, so nothing may exceed full travel. */
const MAX_LATERAL = 1.0

/**
 * Full-stick body attitude in pose mode, in radians. Sign convention follows
 * the body frame the robot's own imu rpy uses (x forward, y left, z up):
 * positive roll dips the right side, positive pitch drops the nose, positive
 * yaw looks left. Taken from the frame definition rather than measured - if the
 * robot leans the wrong way on the bench, flip the signs here and nowhere else.
 */
const EULER_LIMITS = { roll: 0.75, pitch: 0.75, yaw: 0.6 }

const clamp = (v: number, limit: number) => Math.max(-limit, Math.min(limit, v))

/** Step one axis toward its demand, no faster than the ramp allows. */
function approach(current: number, target: number): number {
  const rate = Math.abs(target) > Math.abs(current) ? RAMP_UP : RAMP_DOWN
  const delta = target - current
  if (Math.abs(delta) <= rate) return target
  return current + Math.sign(delta) * rate
}

/**
 * Collects drive input from the sticks, the keyboard, and a gamepad, then sends
 * the resulting velocity at a fixed rate. The robot expects a continuous stream
 * while moving - a single Move command only produces a short step.
 */
export function useDriveLoop(limits: DriveLimits, enabled: boolean) {
  const { moveSticks, setEuler, posing, connState } = useRobot()
  const stick = useRef<DriveVector>(ZERO)
  const keys = useRef(new Set<string>())
  const gamepadIndex = useRef<number | null>(null)
  const trailing = useRef(0)
  /** The ramped command actually on the wire, as opposed to the raw demand. */
  const sent = useRef<DriveVector>(ZERO)
  const [active, setActive] = useState<DriveVector>(ZERO)
  const [gamepadName, setGamepadName] = useState<string | null>(null)

  // Read through a ref so adjusting a speed slider does not restart the loop -
  // restarting mid-stride would send a stop and interrupt the drive.
  const limitsRef = useRef(limits)
  limitsRef.current = limits
  // Read through a ref too: restarting the effect on entering pose would run
  // its cleanup, and leaving the loop mid-pose must not disturb the robot.
  const posingRef = useRef(posing)
  posingRef.current = posing

  const setStick = useCallback((v: DriveVector) => {
    stick.current = v
  }, [])

  // keyboard
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      // Only a control being typed into gets the keys. This used to match
      // every <input>, so touching a speed slider or a toggle left the
      // drive keys dead until something else was clicked.
      if (isTextEntry(e.target)) return
      const k = e.key.toLowerCase()
      if (DRIVE_KEYS.has(k)) {
        keys.current.add(k)
        e.preventDefault()
      }
    }
    const up = (e: KeyboardEvent) => {
      keys.current.delete(e.key.toLowerCase())
    }
    const blur = () => keys.current.clear()
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [])

  // gamepad presence
  useEffect(() => {
    const onConnect = (e: GamepadEvent) => {
      gamepadIndex.current = e.gamepad.index
      setGamepadName(e.gamepad.id)
    }
    const onDisconnect = () => {
      gamepadIndex.current = null
      setGamepadName(null)
    }
    window.addEventListener('gamepadconnected', onConnect)
    window.addEventListener('gamepaddisconnected', onDisconnect)
    return () => {
      window.removeEventListener('gamepadconnected', onConnect)
      window.removeEventListener('gamepaddisconnected', onDisconnect)
    }
  }, [])

  useEffect(() => {
    if (!enabled || connState !== 'connected') {
      sent.current = ZERO
      setActive(ZERO)
      return
    }

    // Tracks whether the last command sent was a movement, so the cleanup below
    // can settle the robot if the loop is torn down mid-stride.
    let inMotion = false
    // The displayed vector is quantised so a 20Hz loop does not re-render the
    // whole drive column 20 times a second and starve its own timer.
    let shown = ''

    const tick = () => {
      let { x, y, z } = stick.current

      // keyboard overrides toward whichever direction is held
      const k = keys.current
      if (k.has('w') || k.has('arrowup')) y = 1
      if (k.has('s') || k.has('arrowdown')) y = -1
      if (k.has('a')) x = -1
      if (k.has('d')) x = 1
      if (k.has('q') || k.has('arrowleft')) z = 1
      if (k.has('e') || k.has('arrowright')) z = -1

      // gamepad wins when a stick is actually deflected
      if (gamepadIndex.current !== null) {
        const pad = navigator.getGamepads()[gamepadIndex.current]
        if (pad) {
          const dz = (v: number) => (Math.abs(v) < 0.12 ? 0 : v)
          const gx = dz(pad.axes[0] ?? 0)
          const gy = dz(-(pad.axes[1] ?? 0))
          const gz = dz(-(pad.axes[2] ?? 0))
          if (gx || gy) {
            x = gx
            y = gy
          }
          if (gz) z = gz
        }
      }

      // Hold the translation demand inside the unit circle. Pressing W and D
      // together used to ask for 1.41x the straight-line speed, which is enough
      // on its own to make a diagonal walk look unsteady.
      const magnitude = Math.hypot(x, y)
      if (magnitude > 1) {
        x /= magnitude
        y /= magnitude
      }

      const cur = sent.current
      const next = { x: approach(cur.x, x), y: approach(cur.y, y), z: approach(cur.z, z) }
      sent.current = next

      const moving = Math.abs(next.x) > EPSILON || Math.abs(next.y) > EPSILON || Math.abs(next.z) > EPSILON
      const { linear, angular } = limitsRef.current

      const send = (v: DriveVector) => {
        if (posingRef.current) {
          // In pose mode the feet stay planted and the same sticks lean the
          // body instead. Stick x rolls, y pitches, q/e yaw.
          setEuler(v.x * EULER_LIMITS.roll, v.y * EULER_LIMITS.pitch, v.z * EULER_LIMITS.yaw)
          return
        }
        // The wireless controller takes stick deflection, not velocities, and
        // the robot applies its own envelope to it - exactly as it does for the
        // handheld remote. Driving through the sport Move api instead meant
        // this console was asking for raw velocities down a path built for
        // discrete commands, which is a large part of why it felt less steady
        // than the app. lx strafes, ly is forward, rx turns.
        //
        // rx is negated: this codebase's z is positive-is-left, and the
        // transcribed note claiming rx was also positive-is-left is wrong.
        // Measured on hardware - without this, Q turned right and E turned left.
        moveSticks(clamp(v.x * linear, MAX_LATERAL), v.y * linear, -v.z * angular, 0)
      }

      if (moving) {
        trailing.current = TRAILING_ZEROS
        inMotion = true
        send(next)
      } else if (trailing.current > 0) {
        trailing.current--
        sent.current = ZERO
        send(ZERO)
        if (trailing.current === 0) inMotion = false
      }
      // Once the trailing zeros are done the loop simply goes quiet. It must
      // NOT send StopMove: that is a state-machine transition, not a brake, and
      // it drops the robot out of a handstand, pose mode, or any special gait -
      // which is why letting go of a key used to knock it out of the mode.

      const label = next.x.toFixed(2) + ',' + next.y.toFixed(2) + ',' + next.z.toFixed(2)
      if (label !== shown) {
        shown = label
        setActive(moving ? next : ZERO)
      }
    }

    const id = setInterval(tick, SEND_MS)
    return () => {
      clearInterval(id)
      // Turning the loop off while the robot is walking must not leave a
      // velocity command as the last thing it heard. Zeros only - see above.
      if (inMotion) {
        if (posingRef.current) setEuler(0, 0, 0)
        else moveSticks(0, 0, 0, 0)
      }
      trailing.current = 0
      keys.current.clear()
      stick.current = ZERO
      sent.current = ZERO
      setActive(ZERO)
    }
  }, [enabled, connState, moveSticks, setEuler])

  return { setStick, active, gamepadName }
}

const DRIVE_KEYS = new Set([
  'w', 'a', 's', 'd', 'q', 'e',
  'arrowup', 'arrowdown', 'arrowleft', 'arrowright',
])

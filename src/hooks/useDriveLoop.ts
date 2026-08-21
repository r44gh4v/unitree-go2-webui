import { useCallback, useEffect, useRef, useState } from 'react'
import { useRobot } from '../state/RobotContext'

const SEND_HZ = 20
const SEND_MS = 1000 / SEND_HZ
/** Keep sending zeros briefly after release so the robot reliably stops. */
const TRAILING_ZEROS = 4

export interface DriveVector {
  x: number
  y: number
  z: number
}

export interface DriveLimits {
  /** metres per second at full stick */
  linear: number
  /** radians per second at full stick */
  angular: number
}

const ZERO: DriveVector = { x: 0, y: 0, z: 0 }

/** The robot refuses sideways commands beyond this, whatever the slider says. */
const MAX_LATERAL = 1.0

const clamp = (v: number, limit: number) => Math.max(-limit, Math.min(limit, v))

/**
 * Collects drive input from the sticks, the keyboard, and a gamepad, then sends
 * the resulting velocity at a fixed rate. The robot expects a continuous stream
 * while moving - a single Move command only produces a short step.
 */
export function useDriveLoop(limits: DriveLimits, enabled: boolean) {
  const { move, stopMove, connState } = useRobot()
  const stick = useRef<DriveVector>(ZERO)
  const keys = useRef(new Set<string>())
  const gamepadIndex = useRef<number | null>(null)
  const trailing = useRef(0)
  const [active, setActive] = useState<DriveVector>(ZERO)
  const [gamepadName, setGamepadName] = useState<string | null>(null)

  // Read through a ref so adjusting a speed slider does not restart the loop -
  // restarting mid-stride would send a stop and interrupt the drive.
  const limitsRef = useRef(limits)
  limitsRef.current = limits

  const setStick = useCallback((v: DriveVector) => {
    stick.current = v
  }, [])

  // keyboard
  useEffect(() => {
    const isTyping = (t: EventTarget | null) => {
      const el = t as HTMLElement | null
      return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
    }
    const down = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return
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
      setActive(ZERO)
      return
    }

    // Tracks whether the last command sent was a movement, so the cleanup below
    // can stop the robot if the loop is torn down mid-stride.
    let inMotion = false

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

      const moving = x !== 0 || y !== 0 || z !== 0
      if (moving) {
        trailing.current = TRAILING_ZEROS
        inMotion = true
        const { linear, angular } = limitsRef.current
        // Stick y is forward, x is right; the robot takes x forward, y left.
        // Sideways is capped lower than forward because the robot itself is.
        move(y * linear, clamp(-x * linear, MAX_LATERAL), z * angular)
        setActive({ x, y, z })
      } else if (trailing.current > 0) {
        trailing.current--
        move(0, 0, 0)
        if (trailing.current === 0) {
          stopMove()
          inMotion = false
        }
        setActive(ZERO)
      }
    }

    const id = setInterval(tick, SEND_MS)
    return () => {
      clearInterval(id)
      // Turning the loop off while the robot is walking must not leave a
      // velocity command as the last thing it heard.
      if (inMotion) {
        move(0, 0, 0)
        stopMove()
      }
      trailing.current = 0
      keys.current.clear()
      stick.current = ZERO
      setActive(ZERO)
    }
  }, [enabled, connState, move, stopMove])

  return { setStick, active, gamepadName }
}

const DRIVE_KEYS = new Set([
  'w', 'a', 's', 'd', 'q', 'e',
  'arrowup', 'arrowdown', 'arrowleft', 'arrowright',
])

import { useCallback, useEffect, useRef, useState } from 'react'
import Joystick from './Joystick'
import { useRobot } from '../state/RobotContext'
import { TOPICS } from '../lib/constants'
import { firstGamepad, gamepadKeys } from '../lib/gamepad'

const SEND_HZ = 20
const SEND_MS = 1000 / SEND_HZ
const TRAILING = 4

/**
 * The two-stick layout the phone app uses. The left stick translates (forward /
 * back / strafe), the right stick turns and looks. Values stream to the wireless
 * controller topic at a fixed rate while a stick is held, exactly like the
 * handheld remote, and a zeroed frame is sent on release so the robot stops.
 */
export default function RemoteControl() {
  const { conn, connState } = useRobot()
  const connected = connState === 'connected'

  const left = useRef({ x: 0, y: 0 })
  const right = useRef({ x: 0, y: 0 })
  const trailing = useRef(0)
  const [active, setActive] = useState(false)

  const setLeft = useCallback((x: number, y: number) => (left.current = { x, y }), [])
  const setRight = useCallback((x: number, y: number) => (right.current = { x, y }), [])

  useEffect(() => {
    if (!connected) return
    const send = (lx: number, ly: number, rx: number, ry: number, keys: number) =>
      conn.publish(TOPICS.WIRELESS_CONTROLLER, { lx, ly, rx, ry, keys }, 'msg', true)

    const id = setInterval(() => {
      const l = left.current
      const r = right.current
      // ly forward, lx strafe-right, rx turn-left (per the wireless controller
      // convention), ry look. Right stick x is negated so pushing right turns right.
      const lx = l.x
      const ly = l.y
      const rx = -r.x
      const ry = r.y
      // A plugged-in gamepad's face buttons ride along in the keys bitmask, just
      // as they would on the real handheld remote.
      const pad = firstGamepad()
      const keys = pad ? gamepadKeys(pad) : 0
      const moving = lx || ly || rx || ry || keys

      if (moving) {
        trailing.current = TRAILING
        send(lx, ly, rx, ry, keys)
        setActive(true)
      } else if (trailing.current > 0) {
        trailing.current--
        send(0, 0, 0, 0, 0)
        if (trailing.current === 0) setActive(false)
      }
    }, SEND_MS)

    return () => {
      clearInterval(id)
      // Make sure a release while unmounting still stops the robot.
      send(0, 0, 0, 0, 0)
      left.current = { x: 0, y: 0 }
      right.current = { x: 0, y: 0 }
      setActive(false)
    }
  }, [connected, conn])

  return (
    <div className={`remote${active ? ' active' : ''}`}>
      <div className="remote-stick">
        <Joystick label="Move" size={96} onChange={setLeft} disabled={!connected} />
      </div>
      <div className="remote-stick">
        <Joystick label="Turn / look" size={96} onChange={setRight} disabled={!connected} />
      </div>
    </div>
  )
}

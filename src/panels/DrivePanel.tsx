import { useCallback, useEffect, useState } from 'react'
import Joystick from '../components/Joystick'
import { useRobot } from '../state/RobotContext'
import { useDriveLoop } from '../hooks/useDriveLoop'
import { ScanIcon, ShieldIcon } from '../components/Icons'

/** Sticks, speed, and what the robot is allowed to sense. */
export default function DrivePanel() {
  const { connState, posing, sensing } = useRobot()
  const connected = connState === 'connected'
  // The lidar and the assist that reads it move together, and useSensing owns
  // that rule. This panel only draws two toggles.
  const { lidarOn, avoidance, busy, setLidar, setAvoidance, recheckAvoidance } = sensing

  /**
   * How far a full input pushes each stick. These scale what goes on the wire,
   * so they set walking and turning speed independently: at 100% the console
   * sends exactly what the handheld remote and the phone app send at full
   * stick, and lower values are slower.
   *
   * These are the only speed controls. The robot's own gait pace (SpeedLevel)
   * was offered alongside them and is not: it only ever moved between slow and
   * fast in practice, never back to normal, and it covers nothing these two do
   * not already do more precisely and independently.
   */
  const [linear, setLinear] = useState(1)
  const [angular, setAngular] = useState(1)

  // Full travel every time, and never remembered. A speed you set for one
  // careful run through a doorway should not still be in force next time you
  // connect, quietly making the robot feel broken. Reloading gives the same
  // fresh start, since nothing here is persisted.
  useEffect(() => {
    if (!connected) return
    setLinear(1)
    setAngular(1)
  }, [connected])

  const { setStick, active } = useDriveLoop({ linear, angular }, connected)

  const onWalk = useCallback((x: number, y: number) => setStick({ x, y, z: 0 }), [setStick])
  const onTurn = useCallback((x: number) => setStick({ x: 0, y: 0, z: -x }), [setStick])

  return (
    <>
      <div className="section">
        <p className="eyebrow">Drive</p>

        {/* The dials show whatever is driving, not just the mouse: holding W
            walks the left nub up its dial and lights the W cap, so the keyboard
            and a gamepad are visible on the same instrument. In pose mode the
            same two sticks lean the body, so they say so. */}
        <div className="sticks">
          <Joystick
            label={posing ? 'Lean' : 'Walk'}
            size={104}
            onChange={onWalk}
            disabled={!connected}
            value={{ x: active.x, y: active.y }}
            keys={{ up: 'W', down: 'S', left: 'A', right: 'D' }}
          />
          <Joystick
            label={posing ? 'Twist' : 'Turn'}
            size={104}
            onChange={(x) => onTurn(x)}
            disabled={!connected}
            value={{ x: -active.z, y: 0 }}
            keys={{ left: 'Q', right: 'E' }}
          />
        </div>

        {/* Walk and Turn are the everyday speed controls: they scale what goes
            on the wire, independently, and 100% is what the remote sends. */}
        <div className="slider-row">
          <label htmlFor="lin">Walk</label>
          <input
            id="lin"
            type="range"
            min={0.2}
            max={1}
            step={0.05}
            value={linear}
            disabled={posing}
            title="Walking speed, as a share of full stick. 100% matches the handheld remote"
            onChange={(e) => setLinear(Number(e.target.value))}
          />
          <span className="val">{Math.round(linear * 100)}%</span>
        </div>
        <div className="slider-row">
          <label htmlFor="ang">Turn</label>
          <input
            id="ang"
            type="range"
            min={0.2}
            max={1}
            step={0.05}
            value={angular}
            disabled={posing}
            title="Turning speed, as a share of full stick. Independent of the walking speed above"
            onChange={(e) => setAngular(Number(e.target.value))}
          />
          <span className="val">{Math.round(angular * 100)}%</span>
        </div>

        <label
          className={`toggle${avoidance ? ' on' : ''}`}
          style={{ marginTop: 8 }}
          title={
            avoidance === null
              ? 'The robot has not reported this state yet. You can still set it'
              : avoidance
                ? 'On: the robot refuses drive commands that would hit something'
                : lidarOn
                  ? 'Off: the robot will drive into things if you steer it into them'
                  : 'Off. Turning it on starts the lidar, which it needs to see'
          }
        >
          <span className="toggle-label">
            <ShieldIcon size={15} />
            Obstacle avoidance
            {connected && avoidance === null && (
              <button
                className="btn sm ghost"
                style={{ padding: '0 6px' }}
                title="The robot has not reported this state - ask it again"
                onClick={(e) => {
                  e.preventDefault()
                  recheckAvoidance()
                }}
              >
                unknown - recheck
              </button>
            )}
          </span>
          <input
            type="checkbox"
            checked={!!avoidance}
            disabled={!connected || busy}
            onChange={(e) => setAvoidance(e.target.checked)}
            style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }}
          />
          <span className="track" />
        </label>

        {/* The sensor itself, not the map view. Off stops it turning, which is
            worth doing when the map is not in use - it is a moving part, and it
            costs bandwidth and battery. It sits with obstacle avoidance because
            both are about what the robot can sense. */}
        <label
          className={`toggle${lidarOn ? ' on' : ''}`}
          style={{ marginTop: 8 }}
          title={
            lidarOn
              ? 'Stop the lidar spinning. Obstacle avoidance needs it, so that goes off too'
              : 'Start the lidar. It spins while on, and feeds the Lidar tab'
          }
        >
          <span className="toggle-label">
            <ScanIcon size={15} />
            Lidar
          </span>
          <input
            type="checkbox"
            checked={lidarOn}
            disabled={!connected || busy}
            onChange={(e) => setLidar(e.target.checked)}
            style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }}
          />
          <span className="track" />
        </label>
      </div>
    </>
  )
}

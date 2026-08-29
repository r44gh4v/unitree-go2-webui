import { useCallback, useEffect, useState } from 'react'
import Joystick from '../components/Joystick'
import { useRobot } from '../state/RobotContext'
import { useDriveLoop } from '../hooks/useDriveLoop'
import { OBSTACLES_AVOID_API, SPORT_CMD, SPORT_CMD_MCF, TOPICS } from '../lib/constants'
import { unwrapResponse } from '../lib/go2'
import { ScanIcon, ShieldIcon } from '../components/Icons'

/** Some state topics arrive as a JSON string inside the message rather than an object. */
function decodeMaybeString<T>(value: unknown): T | null {
  if (value == null) return null
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T
    } catch {
      return null
    }
  }
  return value as T
}

interface MultipleState {
  speedLevel?: number
}

/** Sticks, speeds, and what the robot is allowed to sense. */
export default function DrivePanel() {
  const { connState, conn, sport, motionMode, posing, lidarOn, setLidarOn, log } = useRobot()
  const connected = connState === 'connected'

  // Commands go out as stick deflection now, not velocities, so these scale
  // how far a full input pushes the stick. The robot keeps its own speed
  // envelope, exactly as it does for the handheld remote; use Pace below to
  // change how fast it actually walks.
  const [linear, setLinear] = useState(1.0)
  const [angular, setAngular] = useState(1.0)
  const [speedLevel, setSpeedLevel] = useState(0)
  const [avoidance, setAvoidance] = useState<boolean | null>(null)
  const [stanceError, setStanceError] = useState<string | null>(null)
  /** Set once the robot has reported its pace, so we stop overwriting the operator. */
  const [stanceRead, setStanceRead] = useState(false)

  // Read the current obstacle-avoidance state; reused by the recheck link
  // when the first read fails and the state is unknown.
  const readAvoidance = useCallback(async () => {
    try {
      const res = await conn.request(TOPICS.OBSTACLES_AVOID, OBSTACLES_AVOID_API.SWITCH_GET)
      const a = unwrapResponse<{ enable: boolean }>(res)
      if (typeof a?.enable === 'boolean') setAvoidance(a.enable)
    } catch {
      /* stays unknown; the toggle stays disabled and offers a recheck */
    }
  }, [conn])

  useEffect(() => {
    if (!connected) {
      setAvoidance(null)
      setStanceRead(false)
      return
    }
    void readAvoidance()
  }, [connected, readAvoidance])

  // The sliders used to start at zero and claim that was the robot's stance,
  // which was a lie until someone moved them. The robot already reports the
  // real values on rt/multiplestate, so take the first report and stop.
  useEffect(() => {
    if (!connected || stanceRead) return
    const unsub = conn.subscribe(TOPICS.MULTIPLE_STATE, (d) => {
      const m = decodeMaybeString<MultipleState>(d)
      if (!m) return
      if (typeof m.speedLevel === 'number') setSpeedLevel(m.speedLevel)
      setStanceRead(true)
    })
    return unsub
  }, [connected, conn, stanceRead])

  const toggleAvoidance = async (next: boolean) => {
    try {
      await conn.request(TOPICS.OBSTACLES_AVOID, OBSTACLES_AVOID_API.SWITCH_SET, { enable: next })
      setAvoidance(next)
      log(`Obstacle avoidance ${next ? 'on' : 'off'}`)
    } catch (e) {
      log(`Obstacle avoidance: ${(e as Error).message}`)
    }
  }

  const { setStick, active, gamepadName } = useDriveLoop({ linear, angular }, connected)

  const onWalk = useCallback((x: number, y: number) => setStick({ x, y, z: 0 }), [setStick])
  const onTurn = useCallback((x: number) => setStick({ x: 0, y: 0, z: -x }), [setStick])

  const ids = motionMode === 'mcf' ? SPORT_CMD_MCF : SPORT_CMD

  /**
   * Stance api id under the running motion service. The MCF table has no entry
   * for body height or foot raise height, but every other low id is shared
   * between the services, so fall back to the normal-mode id rather than
   * refusing locally - and let the robot's own "API not registered" answer be
   * the thing the operator sees if it really is absent.
   */
  const stanceId = (key: 'SpeedLevel'): number =>
    (ids as Record<string, number | undefined>)[key] ?? SPORT_CMD[key]

  // Stance changes are worth reporting in the panel itself: a refused body
  // height used to vanish into the console with the slider left lying about it.
  const stance = (apiId: number | undefined, parameter: unknown, label: string, revert: () => void) => {
    if (apiId === undefined) {
      setStanceError(`${label} is not available in ${motionMode} mode.`)
      revert()
      return
    }
    setStanceError(null)
    sport(apiId, parameter).catch((e) => {
      setStanceError(`${label}: ${(e as Error).message}`)
      revert()
    })
  }

  const moving = active.x !== 0 || active.y !== 0 || active.z !== 0

  return (
    <>
      <div className="section">
        <p className="eyebrow">Drive</p>

        {/* The same two sticks lean the body while pose mode is on, so they say
            so rather than claiming to walk the robot. */}
        {/* The dials show whatever is driving, not just the mouse: holding W
            walks the left nub up its dial and lights the W cap, so the keyboard
            and a gamepad are visible on the same instrument. */}
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



        <div className="slider-row">
          <label htmlFor="lin">Walk</label>
          <input id="lin" type="range" min={0.2} max={1} step={0.05} value={linear} disabled={posing} title="How far a full input pushes the walk stick" onChange={(e) => setLinear(Number(e.target.value))} />
          <span className="val">{Math.round(linear * 100)}%</span>
        </div>
        <div className="slider-row">
          <label htmlFor="ang">Turn</label>
          <input id="ang" type="range" min={0.2} max={1} step={0.05} value={angular} disabled={posing} title="How far a full input pushes the turn stick" onChange={(e) => setAngular(Number(e.target.value))} />
          <span className="val">{Math.round(angular * 100)}%</span>
        </div>

        {/* Walk and Turn scale our own stick; Pace is the robot's gear and is
            the only one of the three the robot itself holds. It is read back
            from rt/multiplestate on connect, so it shows what is actually set
            rather than needing to be applied again. */}
        <div className="slider-row">
          <label htmlFor="sl">Pace</label>
          <input
            id="sl" type="range" min={-1} max={1} step={1} value={speedLevel} disabled={!connected}
            title="The robot's own gait pace. Set on the robot, and read back when you connect"
            onChange={(e) => setSpeedLevel(Number(e.target.value))}
            onPointerUp={() => stance(stanceId('SpeedLevel'), { data: speedLevel }, 'Pace', () => setSpeedLevel(0))}
            onKeyUp={() => stance(stanceId('SpeedLevel'), { data: speedLevel }, 'Pace', () => setSpeedLevel(0))}
          />
          <span className="val">{speedLevel > 0 ? 'fast' : speedLevel < 0 ? 'slow' : 'normal'}</span>
        </div>
        {stanceError && (
          <p className="note warn" role="alert">
            {stanceError}
          </p>
        )}

        <label
          className={`toggle${avoidance ? ' on' : ''}`}
          style={{ marginTop: 8 }}
          title={
            avoidance === null
              ? 'The robot has not reported this state yet'
              : 'When on, the robot refuses drive commands that would hit something'
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
                  void readAvoidance()
                }}
              >
                unknown - recheck
              </button>
            )}
          </span>
          <input
            type="checkbox"
            checked={!!avoidance}
            disabled={!connected || avoidance === null}
            onChange={(e) => void toggleAvoidance(e.target.checked)}
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
          title="Off stops the lidar spinning, not just the map"
        >
          <span className="toggle-label">
            <ScanIcon size={15} />
            Lidar
          </span>
          <input
            type="checkbox"
            checked={lidarOn}
            disabled={!connected}
            onChange={(e) => setLidarOn(e.target.checked)}
            style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }}
          />
          <span className="track" />
        </label>
      </div>
    </>
  )
}

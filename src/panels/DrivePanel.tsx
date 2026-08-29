import { useCallback, useEffect, useRef, useState } from 'react'
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

const PACE_NAMES: Record<number, string> = { [-1]: 'slow', 0: 'normal', 1: 'fast' }

/** Sticks, speed, and what the robot is allowed to sense. */
export default function DrivePanel() {
  const { connState, conn, sport, motionMode, posing, lidarOn, setLidarOn, log } = useRobot()
  const connected = connState === 'connected'

  const [speedLevel, setSpeedLevel] = useState(0)
  const [avoidance, setAvoidance] = useState<boolean | null>(null)
  const [paceError, setPaceError] = useState<string | null>(null)
  /** Set once the robot has reported its pace, so we stop overwriting the operator. */
  const [paceRead, setPaceRead] = useState(false)
  /**
   * The last pace the robot accepted. A refused change goes back to this rather
   * than to zero - reverting to a value the operator never chose is its own
   * small lie about what the robot is doing.
   */
  const lastPace = useRef(0)

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
      setPaceRead(false)
      setPaceError(null)
      return
    }
    void readAvoidance()
  }, [connected, readAvoidance])

  // Seed the pace from what the robot actually has set, so the slider shows the
  // truth on connect rather than claiming normal and needing to be applied again.
  useEffect(() => {
    if (!connected || paceRead) return
    return conn.subscribe(TOPICS.MULTIPLE_STATE, (d) => {
      const m = decodeMaybeString<MultipleState>(d)
      if (typeof m?.speedLevel !== 'number') return
      setSpeedLevel(m.speedLevel)
      lastPace.current = m.speedLevel
      setPaceRead(true)
    })
  }, [connected, conn, paceRead])

  const toggleAvoidance = async (next: boolean) => {
    try {
      await conn.request(TOPICS.OBSTACLES_AVOID, OBSTACLES_AVOID_API.SWITCH_SET, { enable: next })
      setAvoidance(next)
      log(`Obstacle avoidance ${next ? 'on' : 'off'}`)
    } catch (e) {
      log(`Obstacle avoidance: ${(e as Error).message}`)
    }
  }

  /**
   * How far a full input pushes each stick. These scale what goes on the wire,
   * so they set walking and turning speed independently: at 100% the console
   * sends exactly what the handheld remote and the phone app send at full
   * stick, and lower values are slower.
   *
   * This is a different thing from Pace below, which is the robot's own gait
   * gear and is held on the robot.
   */
  const [linear, setLinear] = useState(1)
  const [angular, setAngular] = useState(1)

  const { setStick, active } = useDriveLoop({ linear, angular }, connected)

  const onWalk = useCallback((x: number, y: number) => setStick({ x, y, z: 0 }), [setStick])
  const onTurn = useCallback((x: number) => setStick({ x: 0, y: 0, z: -x }), [setStick])

  const sendPace = (next: number) => {
    setSpeedLevel(next)
    setPaceError(null)
    const ids = motionMode === 'mcf' ? SPORT_CMD_MCF : SPORT_CMD
    sport(ids.SpeedLevel, { data: next })
      .then(() => {
        lastPace.current = next
        log(`Pace set to ${PACE_NAMES[next] ?? next}`)
      })
      .catch((e) => {
        setPaceError(`Pace: ${(e as Error).message}`)
        setSpeedLevel(lastPace.current)
      })
  }

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

        {/* Pace is a different lever: the robot's own gait gear, held on the
            robot rather than here, which is why it is read back on connect. */}
        <div className="slider-row">
          <label htmlFor="pace">Pace</label>
          <input
            id="pace"
            type="range"
            min={-1}
            max={1}
            step={1}
            value={speedLevel}
            disabled={!connected || posing}
            title="The robot's own gait gear, held on the robot and read back when you connect. Walk and Turn above are the everyday speed controls"
            onChange={(e) => sendPace(Number(e.target.value))}
          />
          <span className="val">{PACE_NAMES[speedLevel] ?? speedLevel}</span>
        </div>
        {paceError && (
          <p className="note warn" role="alert">
            {paceError}
          </p>
        )}

        <label
          className={`toggle${avoidance ? ' on' : ''}`}
          style={{ marginTop: 8 }}
          title={
            avoidance === null
              ? 'The robot has not reported this state yet'
              : avoidance
                ? 'On: the robot refuses drive commands that would hit something'
                : 'Off: the robot will drive into things if you steer it into them'
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
          title={lidarOn ? 'Stop the lidar spinning' : 'Start the lidar. It spins while on, and feeds the Lidar tab'}
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

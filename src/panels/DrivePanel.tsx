import { useCallback, useEffect, useState } from 'react'
import Joystick from '../components/Joystick'
import { useRobot } from '../state/RobotContext'
import { useDriveLoop } from '../hooks/useDriveLoop'
import { OBSTACLES_AVOID_API, SPORT_CMD, SPORT_CMD_MCF, TOPICS } from '../lib/constants'
import { unwrapResponse } from '../lib/go2'
import { ShieldIcon } from '../components/Icons'

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
  bodyHeight?: number
  footRaiseHeight?: number
  speedLevel?: number
}

/** Sticks, speed limits, stance, safety, and the simulated remote. */
export default function DrivePanel() {
  const { connState, conn, sport, motionMode, posing, log } = useRobot()
  const connected = connState === 'connected'

  // Full-stick speeds, matching what the handheld remote and the phone app
  // give you in normal mode. The drive loop ramps toward these rather than
  // stepping straight to them, so they no longer arrive as a shock to the gait.
  const [linear, setLinear] = useState(1.0)
  const [angular, setAngular] = useState(1.5)
  const [bodyHeight, setBodyHeight] = useState(0)
  const [footHeight, setFootHeight] = useState(0)
  const [speedLevel, setSpeedLevel] = useState(0)
  const [avoidance, setAvoidance] = useState<boolean | null>(null)
  const [stanceError, setStanceError] = useState<string | null>(null)
  /** Set once the robot has told us its real stance, so we stop overwriting the operator. */
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
      if (typeof m.bodyHeight === 'number') setBodyHeight(m.bodyHeight)
      if (typeof m.footRaiseHeight === 'number') setFootHeight(m.footRaiseHeight)
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
  const stanceId = (key: 'BodyHeight' | 'FootRaiseHeight' | 'SpeedLevel'): number =>
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

        {/* <p className="note" style={{ textAlign: 'center', minHeight: 18 }}>
          {posing
            ? 'Pose mode - the sticks lean the body. Turn it off in Actions to walk.'
            : moving
              ? `${(active.y * linear).toFixed(2)} fwd · ${(-active.x * linear).toFixed(2)} side · ${(active.z * angular).toFixed(2)} yaw`
              : gamepadName
                ? `Gamepad: ${gamepadName.slice(0, 22)}`
                : 'Hold W A S D to walk, Q and E to turn.'}
        </p> */}

        <div className="slider-row">
          <label htmlFor="lin">Walk</label>
          <input id="lin" type="range" min={0.1} max={2.5} step={0.05} value={linear} disabled={posing} title="Top forward and sideways speed at full stick" onChange={(e) => setLinear(Number(e.target.value))} />
          <span className="val">{linear.toFixed(2)} m/s</span>
        </div>
        <div className="slider-row">
          <label htmlFor="ang">Turn</label>
          <input id="ang" type="range" min={0.1} max={3} step={0.05} value={angular} disabled={posing} title="Top turning speed at full stick" onChange={(e) => setAngular(Number(e.target.value))} />
          <span className="val">{angular.toFixed(2)} r/s</span>
        </div>

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
      </div>

      <div className="section">
        <p className="eyebrow">Stance</p>
        <p className="note">
          Sent when you let go.{!stanceRead && connected && ' Reading the robot…'}
        </p>
        <div className="slider-row">
          <label htmlFor="bh">Height</label>
          <input
            id="bh" type="range" min={-0.18} max={0.03} step={0.01} value={bodyHeight} disabled={!connected}
            title="Stand taller or lower than default"
            onChange={(e) => setBodyHeight(Number(e.target.value))}
            onPointerUp={() => stance(stanceId('BodyHeight'), { data: bodyHeight }, 'Height', () => setBodyHeight(0))}
            onKeyUp={() => stance(stanceId('BodyHeight'), { data: bodyHeight }, 'Height', () => setBodyHeight(0))}
          />
          <span className="val">{bodyHeight === 0 ? 'default' : `${bodyHeight > 0 ? '+' : ''}${(bodyHeight * 100).toFixed(0)} cm`}</span>
        </div>
        <div className="slider-row">
          <label htmlFor="fh">Step</label>
          <input
            id="fh" type="range" min={-0.06} max={0.03} step={0.01} value={footHeight} disabled={!connected}
            title="How high the feet lift on each step - raise it for rough ground"
            onChange={(e) => setFootHeight(Number(e.target.value))}
            onPointerUp={() => stance(stanceId('FootRaiseHeight'), { data: footHeight }, 'Step', () => setFootHeight(0))}
            onKeyUp={() => stance(stanceId('FootRaiseHeight'), { data: footHeight }, 'Step', () => setFootHeight(0))}
          />
          <span className="val">{footHeight === 0 ? 'default' : `${footHeight > 0 ? '+' : ''}${(footHeight * 100).toFixed(0)} cm`}</span>
        </div>
        <div className="slider-row">
          <label htmlFor="sl">Pace</label>
          <input
            id="sl" type="range" min={-1} max={1} step={1} value={speedLevel} disabled={!connected}
            title="The robot's own gait pace"
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
        <button
          className="btn sm ghost block"
          disabled={!connected}
          title="Put height, step and pace back to the robot's defaults"
          onClick={() => {
            setBodyHeight(0)
            setFootHeight(0)
            setSpeedLevel(0)
            stance(stanceId('BodyHeight'), { data: 0 }, 'Height', () => undefined)
            stance(stanceId('FootRaiseHeight'), { data: 0 }, 'Step', () => undefined)
            stance(stanceId('SpeedLevel'), { data: 0 }, 'Pace', () => undefined)
          }}
        >
          Reset stance
        </button>
      </div>

    </>
  )
}

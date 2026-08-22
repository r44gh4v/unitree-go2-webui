import { useCallback, useEffect, useState } from 'react'
import Joystick from '../components/Joystick'
import RemoteControl from '../components/RemoteControl'
import { useRobot } from '../state/RobotContext'
import { useDriveLoop } from '../hooks/useDriveLoop'
import { OBSTACLES_AVOID_API, SPORT_CMD, SPORT_CMD_MCF, TOPICS } from '../lib/constants'
import { unwrapResponse } from '../lib/go2'
import { GamepadIcon, ShieldIcon } from '../components/Icons'

/** Sticks, speed limits, posture shortcuts, body trim, safety, and the remote. */
export default function DrivePanel() {
  const { connState, conn, sport, motionMode, log } = useRobot()
  const connected = connState === 'connected'

  // Full-stick speeds, matching what the handheld remote and the phone app
  // give you in normal mode. The old 0.4 / 0.8 felt sluggish on real hardware.
  const [linear, setLinear] = useState(1.0)
  const [angular, setAngular] = useState(1.5)
  const [enabled, setEnabled] = useState(true)
  const [bodyHeight, setBodyHeight] = useState(0)
  const [footHeight, setFootHeight] = useState(0)
  const [speedLevel, setSpeedLevel] = useState(0)
  const [euler, setEuler] = useState({ roll: 0, pitch: 0, yaw: 0 })
  const [posing, setPosing] = useState(false)
  const [avoidance, setAvoidance] = useState<boolean | null>(null)

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
      return
    }
    void readAvoidance()
  }, [connected, readAvoidance])

  const toggleAvoidance = async (next: boolean) => {
    try {
      await conn.request(TOPICS.OBSTACLES_AVOID, OBSTACLES_AVOID_API.SWITCH_SET, { enable: next })
      setAvoidance(next)
      log(`Obstacle avoidance ${next ? 'on' : 'off'}`)
    } catch (e) {
      log(`Obstacle avoidance: ${(e as Error).message}`)
    }
  }

  const { setStick, active, gamepadName } = useDriveLoop({ linear, angular }, enabled && connected)

  const onWalk = useCallback((x: number, y: number) => setStick({ x, y, z: 0 }), [setStick])
  const onTurn = useCallback((x: number) => setStick({ x: 0, y: 0, z: -x }), [setStick])

  const cmd = (apiId: number, parameter?: unknown, label?: string) =>
    sport(apiId, parameter).catch((e) => log(`${label ?? apiId}: ${(e as Error).message}`))

  const ids = motionMode === 'mcf' ? SPORT_CMD_MCF : SPORT_CMD
  const sendEuler = () => cmd(SPORT_CMD.Euler, { x: euler.roll, y: euler.pitch, z: euler.yaw }, 'Attitude')

  const moving = active.x !== 0 || active.y !== 0 || active.z !== 0

  return (
    <>
      <div className="section">
        <p className="eyebrow">Drive</p>

        <div className="sticks">
          <Joystick label="Walk" size={104} onChange={onWalk} disabled={!connected || !enabled} />
          <Joystick label="Turn" size={104} onChange={(x) => onTurn(x)} disabled={!connected || !enabled} />
        </div>

        <p className="note" style={{ textAlign: 'center', minHeight: 18 }}>
          {moving
            ? `${(active.y * linear).toFixed(2)} fwd · ${(-active.x * linear).toFixed(2)} side · ${(active.z * angular).toFixed(2)} yaw`
            : gamepadName
              ? `Gamepad: ${gamepadName.slice(0, 22)}`
              : 'Hold W A S D to walk, Q and E to turn.'}
        </p>

        <div className="slider-row">
          <label htmlFor="lin">Walk</label>
          <input id="lin" type="range" min={0.1} max={2.5} step={0.05} value={linear} title="Top forward and sideways speed at full stick" onChange={(e) => setLinear(Number(e.target.value))} />
          <span className="val">{linear.toFixed(2)} m/s</span>
        </div>
        <div className="slider-row">
          <label htmlFor="ang">Turn</label>
          <input id="ang" type="range" min={0.1} max={3} step={0.05} value={angular} title="Top turning speed at full stick" onChange={(e) => setAngular(Number(e.target.value))} />
          <span className="val">{angular.toFixed(2)} r/s</span>
        </div>

        <label className={`toggle${enabled ? ' on' : ''}`} title="When off, the keyboard, sticks, and gamepad stop driving the robot">
          <span className="toggle-label">
            <GamepadIcon size={15} />
            Keyboard and sticks live
          </span>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }}
          />
          <span className="track" />
        </label>

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
        <p className="note">How the robot carries itself while walking. Each change is sent when you let go.</p>
        <div className="slider-row">
          <label htmlFor="bh">Height</label>
          <input
            id="bh" type="range" min={-0.18} max={0.03} step={0.01} value={bodyHeight} disabled={!connected}
            title="Stand taller or lower than default"
            onChange={(e) => setBodyHeight(Number(e.target.value))}
            onPointerUp={() => cmd(SPORT_CMD.BodyHeight, { data: bodyHeight }, 'Height')}
            onKeyUp={() => cmd(SPORT_CMD.BodyHeight, { data: bodyHeight }, 'Height')}
          />
          <span className="val">{bodyHeight === 0 ? 'default' : `${bodyHeight > 0 ? '+' : ''}${(bodyHeight * 100).toFixed(0)} cm`}</span>
        </div>
        <div className="slider-row">
          <label htmlFor="fh">Step</label>
          <input
            id="fh" type="range" min={-0.06} max={0.03} step={0.01} value={footHeight} disabled={!connected}
            title="How high the feet lift on each step - raise it for rough ground"
            onChange={(e) => setFootHeight(Number(e.target.value))}
            onPointerUp={() => cmd(SPORT_CMD.FootRaiseHeight, { data: footHeight }, 'Step')}
            onKeyUp={() => cmd(SPORT_CMD.FootRaiseHeight, { data: footHeight }, 'Step')}
          />
          <span className="val">{footHeight === 0 ? 'default' : `${footHeight > 0 ? '+' : ''}${(footHeight * 100).toFixed(0)} cm`}</span>
        </div>
        <div className="slider-row">
          <label htmlFor="sl">Pace</label>
          <input
            id="sl" type="range" min={-1} max={1} step={1} value={speedLevel} disabled={!connected}
            title="The robot's own gait pace"
            onChange={(e) => setSpeedLevel(Number(e.target.value))}
            onPointerUp={() => cmd(ids.SpeedLevel, { data: speedLevel }, 'Pace')}
            onKeyUp={() => cmd(ids.SpeedLevel, { data: speedLevel }, 'Pace')}
          />
          <span className="val">{speedLevel > 0 ? 'fast' : speedLevel < 0 ? 'slow' : 'normal'}</span>
        </div>
        <button
          className="btn sm ghost block"
          disabled={!connected}
          title="Put height, step and pace back to the robot's defaults"
          onClick={() => {
            setBodyHeight(0)
            setFootHeight(0)
            setSpeedLevel(0)
            void cmd(SPORT_CMD.BodyHeight, { data: 0 }, 'Height')
            void cmd(SPORT_CMD.FootRaiseHeight, { data: 0 }, 'Step')
            void cmd(ids.SpeedLevel, { data: 0 }, 'Pace')
          }}
        >
          Reset stance
        </button>
      </div>

      <div className="section">
        <p className="eyebrow">Body tilt</p>
        <p className="note">
          Leans the body while the feet stay planted. The robot only listens to this in pose mode, so the sliders
          stay locked until you turn it on.
        </p>

        <label className={`toggle${posing ? ' on' : ''}`} style={{ marginBottom: 10 }} title="Hold position and follow the tilt sliders">
          <span className="toggle-label">
            <ShieldIcon size={15} />
            Pose mode
          </span>
          <input
            type="checkbox"
            checked={posing}
            disabled={!connected}
            onChange={async (e) => {
              const want = e.target.checked
              try {
                if (want) {
                  await sport(ids.Pose, { data: true })
                } else {
                  await sport(SPORT_CMD.StopMove)
                  setEuler({ roll: 0, pitch: 0, yaw: 0 })
                }
                setPosing(want)
              } catch (err) {
                log(`Pose mode: ${(err as Error).message}`)
              }
            }}
            style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }}
          />
          <span className="track" />
        </label>

        {([
          ['Roll', 'roll', -0.75, 0.75],
          ['Pitch', 'pitch', -0.75, 0.75],
          ['Yaw', 'yaw', -0.6, 0.6],
        ] as const).map(([label, key, min, max]) => (
          <div className="slider-row" key={key}>
            <label htmlFor={`eu-${key}`}>{label}</label>
            <input
              id={`eu-${key}`} type="range" min={min} max={max} step={0.05} value={euler[key]}
              disabled={!connected || !posing}
              title={posing ? `Lean the body in ${label.toLowerCase()}` : 'Turn pose mode on first'}
              onChange={(e) => setEuler((v) => ({ ...v, [key]: Number(e.target.value) }))}
              onPointerUp={sendEuler}
              onKeyUp={sendEuler}
            />
            <span className="val">{euler[key] === 0 ? 'level' : euler[key].toFixed(2)}</span>
          </div>
        ))}

        <button
          className="btn sm ghost block"
          disabled={!connected || !posing}
          title="Bring the body back to level, staying in pose mode"
          onClick={() => {
            setEuler({ roll: 0, pitch: 0, yaw: 0 })
            void cmd(SPORT_CMD.Euler, { x: 0, y: 0, z: 0 }, 'Level')
          }}
        >
          Level the body
        </button>
      </div>

      <div className="section">
        <p className="eyebrow">Simulated remote</p>
        <p className="note">
          Obstacle avoidance filters these.
        </p>
        <RemoteControl />
      </div>
    </>
  )
}

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

  const [linear, setLinear] = useState(0.4)
  const [angular, setAngular] = useState(0.8)
  const [enabled, setEnabled] = useState(true)
  const [bodyHeight, setBodyHeight] = useState(0)
  const [footHeight, setFootHeight] = useState(0)
  const [speedLevel, setSpeedLevel] = useState(0)
  const [euler, setEuler] = useState({ roll: 0, pitch: 0, yaw: 0 })
  const [avoidance, setAvoidance] = useState<boolean | null>(null)

  // Read the current obstacle-avoidance state once connected.
  useEffect(() => {
    if (!connected) {
      setAvoidance(null)
      return
    }
    let cancelled = false
    conn
      .request(TOPICS.OBSTACLES_AVOID, OBSTACLES_AVOID_API.SWITCH_GET)
      .then((res) => {
        const a = unwrapResponse<{ enable: boolean }>(res)
        if (!cancelled && typeof a?.enable === 'boolean') setAvoidance(a.enable)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [connected, conn])

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
          <input id="lin" type="range" min={0.1} max={1.5} step={0.05} value={linear} title="Top forward and sideways speed at full stick" onChange={(e) => setLinear(Number(e.target.value))} />
          <span className="val">{linear.toFixed(2)} m/s</span>
        </div>
        <div className="slider-row">
          <label htmlFor="ang">Turn</label>
          <input id="ang" type="range" min={0.1} max={2.5} step={0.05} value={angular} title="Top turning speed at full stick" onChange={(e) => setAngular(Number(e.target.value))} />
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
              ? 'Obstacle avoidance state unknown'
              : 'When on, the robot refuses drive commands that would hit something'
          }
        >
          <span className="toggle-label">
            <ShieldIcon size={15} />
            Obstacle avoidance
          </span>
          <input
            type="checkbox"
            checked={!!avoidance}
            disabled={!connected}
            onChange={(e) => void toggleAvoidance(e.target.checked)}
            style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }}
          />
          <span className="track" />
        </label>
      </div>

      <div className="section">
        <p className="eyebrow">Trim and attitude</p>
        <div className="slider-row">
          <label htmlFor="bh">Height</label>
          <input
            id="bh" type="range" min={-0.18} max={0.03} step={0.01} value={bodyHeight} disabled={!connected}
            title="Raise or lower the standing height, sent when you release"
            onChange={(e) => setBodyHeight(Number(e.target.value))}
            onPointerUp={() => cmd(SPORT_CMD.BodyHeight, { data: bodyHeight }, 'Height')}
            onKeyUp={() => cmd(SPORT_CMD.BodyHeight, { data: bodyHeight }, 'Height')}
          />
          <span className="val">{bodyHeight.toFixed(2)} m</span>
        </div>
        <div className="slider-row">
          <label htmlFor="fh">Step</label>
          <input
            id="fh" type="range" min={-0.06} max={0.03} step={0.01} value={footHeight} disabled={!connected}
            title="How high the feet lift on each step"
            onChange={(e) => setFootHeight(Number(e.target.value))}
            onPointerUp={() => cmd(SPORT_CMD.FootRaiseHeight, { data: footHeight }, 'Step')}
            onKeyUp={() => cmd(SPORT_CMD.FootRaiseHeight, { data: footHeight }, 'Step')}
          />
          <span className="val">{footHeight.toFixed(2)} m</span>
        </div>
        <div className="slider-row">
          <label htmlFor="sl">Pace</label>
          <input
            id="sl" type="range" min={-1} max={1} step={1} value={speedLevel} disabled={!connected}
            title="The robot's own gait pace: slow, normal, or fast"
            onChange={(e) => setSpeedLevel(Number(e.target.value))}
            onPointerUp={() => cmd(ids.SpeedLevel, { data: speedLevel }, 'Pace')}
            onKeyUp={() => cmd(ids.SpeedLevel, { data: speedLevel }, 'Pace')}
          />
          <span className="val">{speedLevel > 0 ? 'fast' : speedLevel < 0 ? 'slow' : 'normal'}</span>
        </div>

        <div className="divider" />
        <p className="note">Body tilt. Run Pose mode first, Stop to leave it.</p>

        {([
          ['Roll', 'roll', -0.75, 0.75],
          ['Pitch', 'pitch', -0.75, 0.75],
          ['Yaw', 'yaw', -0.6, 0.6],
        ] as const).map(([label, key, min, max]) => (
          <div className="slider-row" key={key}>
            <label htmlFor={`eu-${key}`}>{label}</label>
            <input
              id={`eu-${key}`} type="range" min={min} max={max} step={0.05} value={euler[key]} disabled={!connected}
              title={`Tilt the body in ${label.toLowerCase()} while the feet stay put`}
              onChange={(e) => setEuler((v) => ({ ...v, [key]: Number(e.target.value) }))}
              onPointerUp={sendEuler}
              onKeyUp={sendEuler}
            />
            <span className="val">{euler[key].toFixed(2)}</span>
          </div>
        ))}

        <div className="btn-row">
          <button className="btn sm" disabled={!connected} title="Hold position and follow the tilt sliders" onClick={() => cmd(ids.Pose, { data: true }, 'Pose')}>
            Pose mode
          </button>
          <button
            className="btn sm"
            disabled={!connected}
            title="Reset the body tilt back to level"
            onClick={() => {
              setEuler({ roll: 0, pitch: 0, yaw: 0 })
              cmd(SPORT_CMD.Euler, { x: 0, y: 0, z: 0 }, 'Level')
            }}
          >
            Level
          </button>
        </div>
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

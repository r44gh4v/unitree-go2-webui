import { useRobot } from '../state/RobotContext'
import { FOOT_NAMES, GAITS, MOTOR_NAMES } from '../lib/constants'
import { MODE_NAMES } from '../lib/types'

function num(v: unknown, digits = 2): string {
  return typeof v === 'number' && Number.isFinite(v) ? v.toFixed(digits) : '-'
}

function Stat({ label, value, unit, meter }: { label: string; value: string; unit?: string; meter?: { pct: number; tone?: string } }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className="value">
        {value}
        {unit && <small> {unit}</small>}
      </div>
      {meter && (
        <div className={`meter${meter.tone ? ` ${meter.tone}` : ''}`}>
          <i style={{ width: `${Math.max(0, Math.min(100, meter.pct))}%` }} />
        </div>
      )}
    </div>
  )
}

/**
 * The numbers an operator glances at while driving: charge, posture, speed,
 * then the detail tables for when something looks wrong.
 */
export default function StatusPanel() {
  const { lowState, sportState, robotErrors, clearErrors, connState } = useRobot()

  if (connState !== 'connected') {
    return (
      <div className="section">
        <p className="note">Status appears once the robot is connected.</p>
      </div>
    )
  }

  const bms = lowState?.bms_state
  const soc = typeof bms?.soc === 'number' ? bms.soc : null
  const motors = Array.isArray(lowState?.motor_state) ? lowState!.motor_state!.slice(0, 12) : []
  const feet = Array.isArray(lowState?.foot_force) ? lowState!.foot_force!.slice(0, 4) : []
  const cells = Array.isArray(bms?.cell_vol) ? bms!.cell_vol! : []
  const rpy = lowState?.imu_state?.rpy ?? sportState?.imu_state?.rpy ?? []
  const vel = sportState?.velocity ?? []
  const speed = vel.length ? Math.hypot(vel[0] ?? 0, vel[1] ?? 0) : null
  const active = robotErrors.filter((e) => !e.cleared)
  const hottest = motors.reduce((m, x) => Math.max(m, typeof x.temperature === 'number' ? x.temperature : 0), 0)

  return (
    <>
      <div className="section">
        <div className="stats">
          <Stat
            label="Charge"
            value={soc !== null ? String(soc) : '-'}
            unit="%"
            meter={soc !== null ? { pct: soc, tone: soc < 15 ? 'bad' : soc < 30 ? 'warn' : undefined } : undefined}
          />
          <Stat label="Speed" value={speed !== null ? speed.toFixed(2) : '-'} unit="m/s" />
          <Stat label="Posture" value={sportState?.mode !== undefined ? (MODE_NAMES[sportState.mode] ?? String(sportState.mode)) : '-'} />
          <Stat label="Gait" value={GAITS.find((g) => g.value === sportState?.gait_type)?.label ?? '-'} />
          <Stat label="Height" value={num(sportState?.body_height)} unit="m" />
          <Stat
            label="Hottest joint"
            value={hottest ? String(Math.round(hottest)) : '-'}
            unit="°C"
            meter={hottest ? { pct: hottest, tone: hottest > 80 ? 'bad' : hottest > 65 ? 'warn' : undefined } : undefined}
          />
        </div>
      </div>

      {active.length > 0 && (
        <div className="section">
          <p className="eyebrow">Active faults</p>
          {active.slice(0, 6).map((e, i) => (
            <div key={i} style={{ marginBottom: 6 }}>
              <div style={{ fontSize: 13, color: 'var(--crimson)', fontWeight: 600 }}>{e.text}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                {e.source} · {new Date(e.ts).toLocaleTimeString()}
              </div>
            </div>
          ))}
          <button className="btn sm ghost" title="Clear the fault list" onClick={clearErrors}>
            Clear list
          </button>
        </div>
      )}

      <div className="section">
        <p className="eyebrow">Power</p>
        <dl className="kv">
          <dt>Voltage</dt>
          <dd>{num(lowState?.power_v)} V</dd>
          <dt>Current</dt>
          <dd>{num(lowState?.power_a)} A</dd>
          <dt>Charge cycles</dt>
          <dd>{bms?.cycle ?? '-'}</dd>
          <dt>Body temperature</dt>
          <dd>{num(lowState?.temperature_ntc1, 0)} °C</dd>
        </dl>
        {cells.length > 0 && (
          <>
            <div className="divider" />
            <table className="table">
              <tbody>
                {cells.map((v, i) => (
                  <tr key={i}>
                    <td>Cell {i + 1}</td>
                    <td className="num">{(v / 1000).toFixed(3)} V</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>

      <div className="section">
        <p className="eyebrow">Motion</p>
        <dl className="kv">
          <dt>Velocity x / y</dt>
          <dd>
            {num(vel[0])} / {num(vel[1])}
          </dd>
          <dt>Yaw rate</dt>
          <dd>{num(sportState?.yaw_speed)} r/s</dd>
          <dt>Position</dt>
          <dd>
            {num(sportState?.position?.[0])}, {num(sportState?.position?.[1])}
          </dd>
          <dt>Roll / pitch / yaw</dt>
          <dd>
            {num(rpy[0])} {num(rpy[1])} {num(rpy[2])}
          </dd>
          <dt>Step height</dt>
          <dd>{num(sportState?.foot_raise_height)} m</dd>
        </dl>
      </div>

      {feet.length > 0 && (
        <div className="section">
          <p className="eyebrow">Foot contact</p>
          <table className="table">
            <tbody>
              {feet.map((f, i) => (
                <tr key={i}>
                  <td>{FOOT_NAMES[i]}</td>
                  <td className="num">{Math.round(f)}</td>
                  <td style={{ width: '45%' }}>
                    <div className="meter">
                      <i style={{ width: `${Math.min(100, (Math.abs(f) / 300) * 100)}%` }} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {motors.length > 0 && (
        <div className="section">
          <p className="eyebrow">Joints</p>
          <table className="table">
            <thead>
              <tr>
                <th>Joint</th>
                <th style={{ textAlign: 'right' }}>Angle</th>
                <th style={{ textAlign: 'right' }}>Torque</th>
                <th style={{ textAlign: 'right' }}>Temp</th>
              </tr>
            </thead>
            <tbody>
              {motors.map((m, i) => (
                <tr key={i}>
                  <td>{MOTOR_NAMES[i] ?? i}</td>
                  <td className="num">{num(m.q)}</td>
                  <td className="num">{num(m.tau_est, 1)}</td>
                  <td className={typeof m.temperature === 'number' && m.temperature > 80 ? 'num hot' : 'num'}>
                    {num(m.temperature, 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

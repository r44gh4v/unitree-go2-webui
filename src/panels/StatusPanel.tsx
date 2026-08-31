import { useRef, useState } from 'react'
import { useRobot, useTelemetry } from '../state/RobotContext'
import { FOOT_NAMES, GAITS, MOTOR_NAMES, SPORT_QUERIES } from '../lib/constants'
import { unwrapResponse } from '../lib/go2'
import { MODE_NAMES } from '../lib/types'

/** Faults beyond this stay in the list but out of the layout; the rest is a count. */
const FAULTS_SHOWN = 8

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
 * The numbers an operator glances at while driving: battery, posture, speed,
 * then the detail tables for when something looks wrong.
 */
export default function StatusPanel() {
    const { diagnostics, connState, motion } = useRobot()
  const { errors: robotErrors, clearErrors } = diagnostics
  const { sport } = motion
  const { lowState, sportState } = useTelemetry()
    const faultsRef = useRef<HTMLDivElement>(null)
    const [queryResult, setQueryResult] = useState<string | null>(null)

    const runQuery = (label: string, apiId: number, parameter?: unknown) => {
        setQueryResult(`${label}…`)
        sport(apiId, parameter)
            .then((res) => {
                const value = unwrapResponse(res)
                setQueryResult(`${label}: ${typeof value === 'string' ? value : JSON.stringify(value, null, 1)}`)
            })
            .catch((e) => setQueryResult(`${label} failed: ${(e as Error).message}`))
    }

    if (connState !== 'connected') {
        return (
            <div className="section">
                <p className="note">Status appears once the robot is connected</p>
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
                        label="Battery"
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

                {/* Faults live at the bottom of the panel so a burst cannot shove the
            numbers off screen, but the operator still has to know one exists
            while looking at the stats - hence the count here, which jumps. */}
                {active.length > 0 && (
                    <button
                        className="chip warn fault-jump"
                        title="Go to the fault list"
                        onClick={() => faultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })}
                    >
                        <span className="dot" />
                        {active.length} active fault{active.length === 1 ? '' : 's'}
                    </button>
                )}
            </div>

            <details className="section drawer">
                <summary className="eyebrow">Power</summary>
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
            </details>

            <details className="section drawer">
                <summary className="eyebrow">Motion</summary>
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
            </details>

            {feet.length > 0 && (
                <details className="section drawer">
                    <summary className="eyebrow">Foot contact</summary>
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
                </details>
            )}

            {motors.length > 0 && (
                <details className="section drawer">
                    <summary className="eyebrow">Joints</summary>
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
                </details>
            )}

            <details className="section drawer">
                <summary className="eyebrow">Ask the robot</summary>
                <p className="note">Reads a value back</p>
                <div className="btn-row">
                    {SPORT_QUERIES.map((q) => (
                        <button
                            key={q.label}
                            className="btn sm"
                            disabled={connState !== 'connected'}
                            title={`Read the robot's current ${q.label.toLowerCase()}`}
                            onClick={() => runQuery(q.label, q.apiId, q.parameter)}
                        >
                            {q.label}
                        </button>
                    ))}
                </div>
                {queryResult && (
                    <pre className="log" style={{ marginTop: 8, maxHeight: 160 }}>
                        {queryResult}
                    </pre>
                )}
            </details>

            {active.length > 0 && (
                <div className="section" ref={faultsRef}>
                    <p className="eyebrow">Active faults</p>
                    <div className="faults">
                        {active.slice(0, FAULTS_SHOWN).map((e, i) => (
                            <div className="fault" key={i}>
                                <div className="fault-text">{e.text}</div>
                                <div className="fault-meta">
                                    {e.source} · {new Date(e.ts).toLocaleTimeString()}
                                </div>
                            </div>
                        ))}
                    </div>
                    {active.length > FAULTS_SHOWN && (
                        <p className="note">{active.length - FAULTS_SHOWN} older not shown.</p>
                    )}
                    <button className="btn sm ghost" title="Clear the fault list" onClick={clearErrors}>
                        Clear list
                    </button>
                </div>
            )}
        </>
    )
}

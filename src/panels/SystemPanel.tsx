import { useEffect, useRef, useState } from 'react'
import { useRobot } from '../state/RobotContext'
import { unwrapResponse } from '../lib/go2'
import { BASHRUNNER_API, BASH_SCRIPTS, ROBOT_STATE_API, TOPICS } from '../lib/constants'
import { TerminalIcon } from '../components/Icons'

interface ServiceEntry {
  name: string
  status: number
  protect: number | boolean
  version?: string
}

interface MultipleState {
  bodyHeight?: number
  brightness?: number
  footRaiseHeight?: number
  obstaclesAvoidSwitch?: boolean | number
  speedLevel?: number
  uwbSwitch?: boolean | number
  volume?: number
}

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

/** Services, firmware details, and the on-board script runner. */
export default function SystemPanel() {
  const { conn, connState, log } = useRobot()
  const connected = connState === 'connected'

  const [services, setServices] = useState<ServiceEntry[] | null>(null)
  const [svcBusy, setSvcBusy] = useState<Record<string, boolean>>({})
  const [svcError, setSvcError] = useState<string | null>(null)
  // which traffic mode was last set from here; null until someone picks
  const [trafficMode, setTrafficMode] = useState<'full' | 'saving' | null>(null)
  const [trafficError, setTrafficError] = useState<string | null>(null)
  const [multiple, setMultiple] = useState<MultipleState | null>(null)
  const [selfTest, setSelfTest] = useState<unknown[]>([])
  const [lidarState, setLidarState] = useState<unknown>(null)

  const [scriptOut, setScriptOut] = useState<Record<string, string>>({})
  const [running, setRunning] = useState<string | null>(null)
  const [showRisky, setShowRisky] = useState(false)
  const reportTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!connected) {
      setServices(null)
      setMultiple(null)
      setSelfTest([])
      setLidarState(null)
      return
    }

    const unsubs = [
      conn.subscribe(TOPICS.SERVICE_STATE, (d) => {
        const parsed = decodeMaybeString<ServiceEntry[]>(d)
        if (Array.isArray(parsed)) setServices(parsed)
      }),
      conn.subscribe(TOPICS.MULTIPLE_STATE, (d) => {
        const parsed = decodeMaybeString<MultipleState>(d)
        if (parsed) setMultiple(parsed)
      }),
      conn.subscribe(TOPICS.SELF_TEST, (d) => {
        setSelfTest((prev) => {
          const text = JSON.stringify(d)
          return prev.some((p) => JSON.stringify(p) === text) ? prev : [...prev, d].slice(-20)
        })
      }),
      conn.subscribe(TOPICS.ULIDAR_STATE, setLidarState),
    ]

    // The robot only publishes the service list when asked, and the request
    // expires, so it has to be renewed before the window closes.
    const askForReports = () => {
      conn
        .request(TOPICS.ROBOT_STATE, ROBOT_STATE_API.SET_REPORT_FREQ, { interval: 2, duration: 60 })
        .catch(() => log('The robot did not accept the service report request.'))
    }
    askForReports()
    reportTimer.current = setInterval(askForReports, 50000)

    return () => {
      unsubs.forEach((u) => u())
      if (reportTimer.current) clearInterval(reportTimer.current)
      reportTimer.current = null
    }
  }, [connected, conn, log])

  const runScript = async (script: string) => {
    setRunning(script)
    setScriptOut((o) => ({ ...o, [script]: 'Running…' }))
    try {
      // The runner takes one field; arguments live inside the same string.
      const res = await conn.request(TOPICS.BASH_REQ, BASHRUNNER_API.RUN_SCRIPT, { script }, 15000)
      const parsed = unwrapResponse<{ result?: string; info?: unknown }>(res)
      const info = parsed?.info
      setScriptOut((o) => ({
        ...o,
        [script]: typeof info === 'string' ? info : JSON.stringify(parsed ?? res, null, 1),
      }))
    } catch (e) {
      setScriptOut((o) => ({ ...o, [script]: `Failed: ${(e as Error).message}` }))
    } finally {
      setRunning(null)
    }
  }

  const toggleService = async (name: string, on: boolean) => {
    setSvcBusy((b) => ({ ...b, [name]: true }))
    setSvcError(null)
    try {
      await conn.request(TOPICS.ROBOT_STATE, ROBOT_STATE_API.SERVICE_SWITCH, { name, switch: on ? 1 : 0 })
      log(`${name} ${on ? 'started' : 'stopped'}`)
    } catch (e) {
      setSvcError(`${name}: ${(e as Error).message}`)
      log(`${name}: ${(e as Error).message}`)
    } finally {
      setSvcBusy((b) => ({ ...b, [name]: false }))
    }
  }

  const setTraffic = async (mode: 'full' | 'saving') => {
    setTrafficError(null)
    try {
      await conn.disableTrafficSaving(mode === 'full')
      setTrafficMode(mode)
      log(mode === 'full' ? 'Traffic saving off - full-rate topics allowed.' : 'Traffic saving on - high-rate topics are throttled.')
    } catch (e) {
      setTrafficError((e as Error).message)
    }
  }

  if (!connected) {
    return (
      <div className="section">
        <p className="note">System information appears once the robot is connected.</p>
      </div>
    )
  }

  const visibleScripts = BASH_SCRIPTS.filter((s) => showRisky || !s.risky)

  return (
    <div className="section">
      <p className="eyebrow">Settings the robot reports</p>
      {multiple ? (
        <dl className="kv">
          <dt>Body height</dt>
          <dd>{multiple.bodyHeight?.toFixed(2) ?? '-'} m</dd>
          <dt>Step height</dt>
          <dd>{multiple.footRaiseHeight?.toFixed(2) ?? '-'} m</dd>
          <dt>Speed level</dt>
          <dd>{multiple.speedLevel ?? '-'}</dd>
          <dt>Volume</dt>
          <dd>{multiple.volume ?? '-'}/10</dd>
          <dt>Light brightness</dt>
          <dd>{multiple.brightness ?? '-'}/10</dd>
          <dt>Obstacle avoidance</dt>
          <dd>{multiple.obstaclesAvoidSwitch ? 'on' : 'off'}</dd>
          <dt>UWB tracking</dt>
          <dd>{multiple.uwbSwitch ? 'on' : 'off'}</dd>
        </dl>
      ) : (
        <p className="note">Waiting for the robot's first report…</p>
      )}

      <div className="divider" />
      <p className="eyebrow">Services</p>
      {services === null ? (
        <p className="note">Asking the robot for its service list…</p>
      ) : services.length === 0 ? (
        <p className="note">The robot reported no services.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Service</th>
              <th>Version</th>
              <th style={{ textAlign: 'right' }}>State</th>
            </tr>
          </thead>
          <tbody>
            {services.map((s) => (
              <tr key={s.name}>
                <td>{s.name}</td>
                <td style={{ color: 'var(--muted)' }}>{s.version || '-'}</td>
                <td style={{ textAlign: 'right' }}>
                  <button
                    className="btn sm ghost"
                    style={{ color: s.status ? 'var(--ok)' : 'var(--faint)' }}
                    disabled={!!s.protect || !!svcBusy[s.name]}
                    title={s.protect ? 'This service is protected and cannot be switched' : 'Start or stop'}
                    onClick={() => void toggleService(s.name, !s.status)}
                  >
                    {svcBusy[s.name] ? 'switching…' : s.status ? 'running' : 'stopped'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {svcError && (
        <p className="note warn" role="alert">
          {svcError}
        </p>
      )}
      <p className="note">Protected services cannot be switched off. Stopping a motion service disables driving.</p>

      <div className="divider" />
      <p className="eyebrow">Robot information</p>
      <p className="note">
        These read values from the robot by running one of its built-in scripts. It is a fixed menu, not a shell.
      </p>

      {visibleScripts.map((s) => (
        <div key={s.script} style={{ marginBottom: 6 }}>
          <button
            className={`btn sm block${s.risky ? ' danger' : ''}`}
            style={{ justifyContent: 'space-between' }}
            disabled={running !== null}
            title={s.note ?? s.script}
            onClick={() => void runScript(s.script)}
          >
            <span>{s.label}</span>
            <span style={{ fontSize: 10, color: 'var(--muted)' }}>{running === s.script ? '…' : s.script}</span>
          </button>
          {scriptOut[s.script] && (
            <pre className="log" style={{ maxHeight: 140, marginTop: 4 }}>
              {scriptOut[s.script]}
            </pre>
          )}
        </div>
      ))}

      <label className={`toggle${showRisky ? ' on' : ''}`} style={{ marginTop: 8 }} title="Reveal scripts that change robot state, not just read it">
        <span className="toggle-label">
          <TerminalIcon size={15} />
          Show scripts that change robot state
        </span>
        <input
          type="checkbox"
          checked={showRisky}
          onChange={(e) => setShowRisky(e.target.checked)}
          style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }}
        />
        <span className="track" />
      </label>

      {selfTest.length > 0 && (
        <>
          <div className="divider" />
          <p className="eyebrow">Self test</p>
          <pre className="log" style={{ maxHeight: 200 }}>
            {selfTest.map((t) => JSON.stringify(t)).join('\n')}
          </pre>
        </>
      )}

      {lidarState != null && (
        <>
          <div className="divider" />
          <p className="eyebrow">Lidar</p>
          <pre className="log" style={{ maxHeight: 160 }}>
            {JSON.stringify(lidarState, null, 1).slice(0, 3000)}
          </pre>
        </>
      )}

      <div className="divider" />
      <p className="eyebrow">Link</p>
      <div className="btn-row">
        <button
          className={`btn sm${trafficMode === 'full' ? ' on' : ''}`}
          title="Stream high-rate topics at full speed; needed before the lidar"
          onClick={() => void setTraffic('full')}
        >
          Full bandwidth
        </button>
        <button
          className={`btn sm${trafficMode === 'saving' ? ' on' : ''}`}
          title="Throttle high-rate topics to keep the video smooth"
          onClick={() => void setTraffic('saving')}
        >
          Save bandwidth
        </button>
      </div>
      {trafficError && (
        <p className="note warn" role="alert">
          Traffic saving: {trafficError}
        </p>
      )}
      <p className="note">Turn on full bandwidth before streaming the lidar; leave it saving otherwise.</p>
    </div>
  )
}

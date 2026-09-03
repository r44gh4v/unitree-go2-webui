import { useEffect, useRef, useState } from 'react'
import { parseMaybeJson } from '../lib/wireJson'
import { useRobot } from '../state/RobotContext'
import { unwrapResponse } from '../lib/go2'
import { BASHRUNNER_API, BASH_SCRIPTS, ROBOT_STATE_API, TOPICS } from '../lib/constants'
import { settingsFor, type RobotSetting } from '../lib/robotSettings'
import { TerminalIcon } from '../components/Icons'

/** How many distinct self-test results are kept. */
const SELF_TEST_LIMIT = 20

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

/** Services, firmware details, and the on-board script runner. */
export default function SystemPanel() {
  const { conn, connState, ip, motion, sensing, log } = useRobot()
  const motionMode = motion.mode
  const connected = connState === 'connected'

  const [services, setServices] = useState<ServiceEntry[] | null>(null)
  const [svcBusy, setSvcBusy] = useState<Record<string, boolean>>({})
  const [svcError, setSvcError] = useState<string | null>(null)
  // which traffic mode was last set from here; null until someone picks
  const [trafficMode, setTrafficMode] = useState<'full' | 'saving' | null>(null)
  const [trafficError, setTrafficError] = useState<string | null>(null)
  const [multiple, setMultiple] = useState<MultipleState | null>(null)
  const [selfTest, setSelfTest] = useState<unknown[]>([])
  /** What has already been reported, so a repeat is not listed twice. */
  const seenSelfTest = useRef(new Set<string>())

  const [settings, setSettings] = useState<Record<string, boolean | undefined>>({})
  const [settingsError, setSettingsError] = useState<string | null>(null)
  const [scriptOut, setScriptOut] = useState<Record<string, string>>({})
  const [running, setRunning] = useState<string | null>(null)
  const [showRisky, setShowRisky] = useState(false)
  const reportTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!connected) {
      setServices(null)
      setMultiple(null)
      setSelfTest([])
      seenSelfTest.current.clear()
      return
    }

    const unsubs = [
      conn.subscribe(TOPICS.SERVICE_STATE, (d) => {
        const parsed = parseMaybeJson<ServiceEntry[]>(d)
        if (Array.isArray(parsed)) setServices(parsed)
      }),
      conn.subscribe(TOPICS.MULTIPLE_STATE, (d) => {
        const parsed = parseMaybeJson<MultipleState>(d)
        if (parsed) setMultiple(parsed)
      }),
      conn.subscribe(TOPICS.SELF_TEST, (d) => {
        // The robot repeats each self-test result while it holds. Comparing
        // against a set of what has been seen keeps that to one hash per
        // message, rather than re-serialising every kept entry each time.
        const text = JSON.stringify(d)
        if (seenSelfTest.current.has(text)) return
        seenSelfTest.current.add(text)
        setSelfTest((prev) => [...prev, d].slice(-SELF_TEST_LIMIT))
      }),
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

  // Read back everything that offers a getter. A setting with no getter stays
  // undefined and says "not read" rather than defaulting to off and lying.
  useEffect(() => {
    if (!connected) {
      setSettings({})
      return
    }
    let cancelled = false
    for (const s of settingsFor(motionMode)) {
      if (!s.getId || !s.decode) continue
      conn
        .request(s.topic, s.getId)
        .then((res) => {
          if (cancelled) return
          const value = s.decode!(unwrapResponse(res))
          if (value !== undefined) setSettings((p) => ({ ...p, [s.key]: value }))
        })
        .catch(() => undefined)
    }
    return () => {
      cancelled = true
    }
  }, [connected, conn, motionMode])

  const applySetting = async (s: RobotSetting, next: boolean) => {
    setSettingsError(null)
    try {
      await conn.request(s.topic, s.setId, s.encode(next))
      setSettings((p) => ({ ...p, [s.key]: next }))
      log(`${s.label}: ${next ? 'on' : 'off'}`)
    } catch (e) {
      setSettingsError(`${s.label}: ${(e as Error).message}`)
    }
  }

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
        <p className="note">System information appears once the robot is connected</p>
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
      <p className="eyebrow">Robot settings</p>
      <p className="note">
        Settings the phone app also exposes. Each is read from the robot where it offers a getter, and left unknown
        rather than guessed where it does not.
      </p>
      {settingsFor(motionMode).map((s) => {
        const state = settings[s.key]
        return (
          <label
            key={s.key}
            className={`toggle${state ? ' on' : ''} mt-2`}
            title={s.note}
          >
            <span className="toggle-label">
              {s.label}
              {state === undefined && <span style={{ color: 'var(--faint)', fontSize: 11 }}>not read</span>}
            </span>
            <input
              type="checkbox"
              checked={!!state}
              onChange={(e) => void applySetting(s, e.target.checked)}
            />
            <span className="track" />
          </label>
        )
      })}
      {settingsError && (
        <p className="note warn" role="alert">
          {settingsError}
        </p>
      )}

      <div className="divider" />
      <p className="eyebrow">Network</p>
      <p className="note">
        The robot reports addresses but never the network name. Wi-Fi is changed from the phone app over Bluetooth.
      </p>
      <dl className="kv">
        <dt>Reached at</dt>
        <dd>{ip || '-'}</dd>
        <dt>Route</dt>
        <dd>{ip === '192.168.12.1' ? 'Robot hotspot' : 'Shared network or relay'}</dd>
      </dl>
      <button
        className="btn sm block"
        style={{ justifyContent: 'space-between' }}
        disabled={running !== null}
        title="Ask the robot which addresses its wlan0, wlan1 and eth0 interfaces hold"
        onClick={() => void runScript('get_ip_address.sh')}
      >
        <span>Read the robot's addresses</span>
        <span style={{ fontSize: 10, color: 'var(--muted)' }}>{running === 'get_ip_address.sh' ? '…' : ''}</span>
      </button>
      {scriptOut['get_ip_address.sh'] && (
        <pre className="log mt-1" style={{ maxHeight: 120 }}>
          {scriptOut['get_ip_address.sh']}
        </pre>
      )}

      <div className="divider" />
      <p className="eyebrow">Services</p>
      {services === null ? (
        <p className="note">Asking the robot for its service list…</p>
      ) : services.length === 0 ? (
        <p className="note">The robot reported no services</p>
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
      <p className="note">Stopping a motion service disables driving</p>

      <div className="divider" />
      <p className="eyebrow">Robot information</p>
      <p className="note">
        Runs one of the robot's built-in scripts. A fixed menu, not a shell.
      </p>

      {visibleScripts.map((s) => (
        <div key={s.script} className="mb-2">
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
            <pre className="log mt-1" style={{ maxHeight: 140 }}>
              {scriptOut[s.script]}
            </pre>
          )}
        </div>
      ))}

      <label className={`toggle${showRisky ? ' on' : ''} mt-3`} title="Reveal scripts that change robot state, not just read it">
        <span className="toggle-label">
          <TerminalIcon size={15} />
          Show scripts that change robot state
        </span>
        <input
          type="checkbox"
          checked={showRisky}
          onChange={(e) => setShowRisky(e.target.checked)}
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

      {sensing.lidarState != null && (
        <>
          <div className="divider" />
          <p className="eyebrow">Lidar</p>
          <p className="note">
            {sensing.settling ? 'Switching off - still within the reassert window.' : sensing.lidarOn ? 'Switch is on.' : 'Switch is off.'}
          </p>
          <pre className="log" style={{ maxHeight: 160 }}>
            {JSON.stringify(sensing.lidarState, null, 1).slice(0, 3000)}
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
      <p className="note">Full bandwidth before the lidar, saving otherwise</p>
    </div>
  )
}

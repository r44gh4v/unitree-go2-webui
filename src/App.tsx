import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import AuthGate from './components/AuthGate'
import { RobotProvider, useRobot } from './state/RobotContext'
import Split from './components/Split'
import CameraPanel from './components/CameraPanel'
import { AlertIcon } from './components/Icons'
import { MODE_NAMES } from './lib/types'
import { GAITS } from './lib/constants'
import ConnectPanel from './panels/ConnectPanel'
import DrivePanel from './panels/DrivePanel'
import StatusPanel from './panels/StatusPanel'
import ActionsPanel from './panels/ActionsPanel'
import MediaPanel from './panels/MediaPanel'
import MappingPanel from './panels/MappingPanel'
import SystemPanel from './panels/SystemPanel'
import ConsolePanel from './panels/ConsolePanel'

// The lidar view carries three.js, which is most of the interface's weight and
// is useless until someone opens that tab. Loading it on demand keeps it out of
// the first download entirely.
const LidarPanel = lazy(() => import('./panels/LidarPanel'))

const TABS = [
  { key: 'actions', label: 'Actions', title: 'Stand, sit, gestures, gaits and stunts', Panel: ActionsPanel },
  { key: 'media', label: 'Media', title: 'Head light, speaker and sounds', Panel: MediaPanel },
  { key: 'lidar', label: 'Lidar', title: 'What the head lidar sees, in 3D', Panel: LidarPanel },
  { key: 'mapping', label: 'Map', title: 'Map a space, then send the robot places in it', Panel: MappingPanel },
  { key: 'system', label: 'System', title: 'Robot services, version info and link settings', Panel: SystemPanel },
  { key: 'console', label: 'Console', title: 'Send any command by hand and watch the wire', Panel: ConsolePanel },
] as const

function num(v: unknown, digits = 2): string {
  return typeof v === 'number' && Number.isFinite(v) ? v.toFixed(digits) : '-'
}

function Reading({ label, value, unit, tone }: { label: string; value: string; unit?: string; tone?: string }) {
  return (
    <div className={`reading${tone ? ` ${tone}` : ''}`}>
      <span className="reading-label">{label}</span>
      <span className="reading-value">
        {value}
        {unit && <small> {unit}</small>}
      </span>
    </div>
  )
}

/**
 * Runs across the top: the stop, whether the robot is there, and the handful of
 * numbers that decide whether it is safe to keep going. These used to be split
 * between the footer and the Status panel, which meant the battery was only
 * visible while the Status tab happened to be open.
 */
function Rail() {
  const { emergencyStop, connState, connError, ip, lowState, sportState, robotErrors, linkStats } = useRobot()
  const connected = connState === 'connected'
  const soc = lowState?.bms_state?.soc
  const faults = robotErrors.filter((e) => !e.cleared).length
  const vel = sportState?.velocity
  const speed = vel ? Math.hypot(vel[0] ?? 0, vel[1] ?? 0) : null
  const motors = Array.isArray(lowState?.motor_state) ? lowState!.motor_state! : []
  const hottest = motors.reduce((m, x) => Math.max(m, typeof x.temperature === 'number' ? x.temperature : 0), 0)

  // Escape is the panic key and works even while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && connected) {
        e.preventDefault()
        emergencyStop()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [connected, emergencyStop])

  const badge =
    connState === 'connected' ? 'Linked'
      : connState === 'connecting' ? 'Connecting'
        : connState === 'validating' ? 'Verifying'
          : connState === 'error' ? 'Failed'
            : 'Offline'

  return (
    <header className="rail">
      <div className="rail-side">
        <span className={`pill pill-${connState}`} title={connState === 'error' ? (connError ?? undefined) : undefined}>
          {badge}
        </span>
        {connected && <span className="rail-where">{ip}</span>}
        {faults > 0 && (
          <span className="chip warn" title="Faults are listed in full on the Status panel">
            <AlertIcon size={13} />
            {faults} fault{faults === 1 ? '' : 's'}
          </span>
        )}
      </div>

      <button className="estop" onClick={emergencyStop} disabled={!connected} title="Stop the robot immediately">
        <span className="estop-label">STOP</span>
        <kbd>Esc</kbd>
      </button>

      <div className="rail-side rail-end">
        <div className="rail-readings">
          <Reading
            label="Battery"
            value={typeof soc === 'number' ? String(soc) : '-'}
            unit="%"
            tone={typeof soc === 'number' ? (soc < 15 ? 'bad' : soc < 30 ? 'warn' : undefined) : undefined}
          />
          <Reading
            label="Hottest"
            value={hottest ? String(Math.round(hottest)) : '-'}
            unit="°C"
            tone={hottest > 80 ? 'bad' : hottest > 65 ? 'warn' : undefined}
          />
          <Reading label="Speed" value={num(speed)} unit="m/s" />
          <Reading label="Posture" value={sportState?.mode !== undefined ? (MODE_NAMES[sportState.mode] ?? String(sportState.mode)) : '-'} />
          <Reading label="Gait" value={GAITS.find((g) => g.value === sportState?.gait_type)?.label ?? '-'} />
          <Reading label="Data" value={connected ? String(linkStats.rate) : '-'} unit="/s" />
        </div>
      </div>
    </header>
  )
}

interface Toast {
  id: number
  source: string
  text: string
}

/**
 * Surfaces a robot fault the moment it arrives, whatever tab is open, so a motor
 * error or an overheat is not missed while looking at the camera. Faults are
 * still listed in full on the Status tab; these are the transient heads-up.
 */
function FaultToasts() {
  const { robotErrors } = useRobot()
  const [toasts, setToasts] = useState<Toast[]>([])
  const seen = useRef(new Set<string>())
  const nextId = useRef(0)

  useEffect(() => {
    const fresh: Toast[] = []
    for (const e of robotErrors) {
      if (e.cleared) continue
      const key = `${e.ts}:${e.source}:${e.text}`
      if (seen.current.has(key)) continue
      seen.current.add(key)
      fresh.push({ id: nextId.current++, source: e.source, text: e.text })
    }
    if (!fresh.length) return
    setToasts((prev) => [...fresh, ...prev].slice(0, 3))
    const timers = fresh.map((t) => setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== t.id)), 6000))
    return () => timers.forEach(clearTimeout)
  }, [robotErrors])

  if (!toasts.length) return null
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className="toast" role="alert">
          <span className="toast-src">{t.source}</span>
          <span className="toast-text">{t.text}</span>
          <button className="toast-x" onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))} aria-label="Dismiss">
            ×
          </button>
        </div>
      ))}
    </div>
  )
}

function Workspace() {
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('actions')
  const Active = TABS.find((t) => t.key === tab)!.Panel

  return (
    <div className="app">
      <FaultToasts />
      <Rail />
      <div className="main">
        <Split direction="vertical" initial={300} min={240} max={480} storageKey="go2.split.left">
          {/* controls: what you touch constantly */}
          <div className="column" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div className="scroll">
              <ConnectPanel />
              <DrivePanel />
            </div>
          </div>

          <Split direction="vertical" initial={720} min={360} max={1400} storageKey="go2.split.centre">
            {/* view: camera on top, live numbers under it */}
            <Split direction="horizontal" initial={380} min={160} max={900} storageKey="go2.split.camera">
              <CameraPanel />
              <div className="column scroll">
                <StatusPanel />
              </div>
            </Split>

            {/* everything else, one tab at a time */}
            <div className="column" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <nav className="tabs">
                {TABS.map((t) => (
                  <button key={t.key} className={`tab${tab === t.key ? ' active' : ''}`} title={t.title} onClick={() => setTab(t.key)}>
                    {t.label}
                  </button>
                ))}
              </nav>
              <div className="scroll">
                <Suspense fallback={<p className="note" style={{ padding: 14 }}>Loading…</p>}>
                  <Active />
                </Suspense>
              </div>
            </div>
          </Split>
        </Split>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <AuthGate>
      <RobotProvider>
        <Workspace />
      </RobotProvider>
    </AuthGate>
  )
}

import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import AuthGate from './components/AuthGate'
import { RobotProvider, useRobot } from './state/RobotContext'
import Split from './components/Split'
import CameraPanel from './components/CameraPanel'
import { MoonIcon, StopIcon, SunIcon } from './components/Icons'
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
  { key: 'actions', label: 'Actions', title: 'Postures, gestures, gaits, and dynamic moves', Panel: ActionsPanel },
  { key: 'media', label: 'Media', title: 'Head light, speaker, audio library, megaphone, and announcements', Panel: MediaPanel },
  { key: 'lidar', label: 'Lidar', title: 'Live 3D map from the head lidar', Panel: LidarPanel },
  { key: 'mapping', label: 'Map', title: 'Build a map, localise, navigate, and set patrols', Panel: MappingPanel },
  { key: 'system', label: 'System', title: 'Services, robot info scripts, and link bandwidth', Panel: SystemPanel },
  { key: 'console', label: 'Console', title: 'Send any command and watch the raw protocol', Panel: ConsolePanel },
] as const

/** Sits above the drive controls so the stop is always one click away. */
function StopBar() {
  const { emergencyStop, connState, armed } = useRobot()
  const connected = connState === 'connected'

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

  return (
    <div className="stopbar">
      <button className="estop" onClick={emergencyStop} disabled={!connected} title="Stop the robot (Esc)">
        <StopIcon size={15} />
        STOP
      </button>
      {armed && (
        <span className="chip warn" title="Flips and jumps are unlocked">
          <span className="dot" /> armed
        </span>
      )}
    </div>
  )
}

/**
 * Light/dark switch. Until it is touched the interface follows the OS; a click
 * pins the choice (persisted), and the pre-paint script in index.html applies
 * it on the next load before anything renders.
 */
function ThemeToggle() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const pinned = document.documentElement.dataset.theme
    if (pinned === 'dark' || pinned === 'light') return pinned
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })

  const flip = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    document.documentElement.dataset.theme = next
    try {
      localStorage.setItem('go2.theme', next)
    } catch {
      /* private windows may refuse; the choice just won't persist */
    }
    setTheme(next)
  }

  return (
    <button
      className="btn sm ghost theme-toggle"
      title={theme === 'dark' ? 'Switch to the light theme' : 'Switch to the dark theme'}
      onClick={flip}
    >
      {theme === 'dark' ? <SunIcon size={14} /> : <MoonIcon size={14} />}
    </button>
  )
}

function Footer() {
  // Connection state lives in the top-left banner; the footer stays out of its
  // way and carries only the at-a-glance link vitals and key hints.
  const { connState, linkStats, lowState } = useRobot()
  const soc = lowState?.bms_state?.soc
  const connected = connState === 'connected'

  return (
    <footer className="footer">
      <span className="hint">
        <kbd>Esc</kbd> stop · <kbd>WASD</kbd> walk · <kbd>QE</kbd> turn
      </span>

      <div style={{ flex: 1 }} />

      {connected && typeof soc === 'number' && (
        <span className={`pill pill-${soc < 15 ? 'error' : soc < 30 ? 'warn' : 'connected'}`}>{soc}%</span>
      )}

      {connected && (
        <span title={`${linkStats.messages.toLocaleString()} messages · ${(linkStats.bytes / 1024 / 1024).toFixed(1)} MB total`}>
          <b>{linkStats.rate}</b> msg/s
        </span>
      )}

      <ThemeToggle />
    </footer>
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
      <div className="main">
        <Split direction="vertical" initial={300} min={240} max={480} storageKey="go2.split.left">
          {/* controls: what you touch constantly */}
          <div className="column" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <StopBar />
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

      <Footer />
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

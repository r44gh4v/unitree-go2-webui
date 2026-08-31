import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import { isTextEntry } from './lib/focus'
import AuthGate from './components/AuthGate'
import { RobotProvider, useRobot } from './state/RobotContext'
import Split from './components/Split'
import CameraPanel from './components/CameraPanel'
import { AlertIcon } from './components/Icons'
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
  const { connState, connError, ip, motion, diagnostics, link } = useRobot()
  const connected = connState === 'connected'
  const faults = diagnostics.errors.filter((e) => !e.cleared).length

  // Escape is the panic key and works even while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && connected) {
        e.preventDefault()
        motion.emergencyStop()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [connected, motion])

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

      <button className="estop" onClick={motion.emergencyStop} disabled={!connected} title="Stop the robot immediately">
        <span className="estop-label">STOP</span>
        <kbd>Esc</kbd>
      </button>

      <div className="rail-side rail-end">
        <div className="rail-readings">
          <Reading label="Data" value={connected ? String(link.stats.rate) : '-'} unit="/s" />
        </div>
      </div>
    </header>
  )
}

/**
 * Nothing keeps focus after a click.
 *
 * A button, toggle or slider that stays focused once the pointer is done with
 * it goes on eating the keyboard: arrow keys nudge the slider the operator
 * thought they had finished with, and the ring reads as stuck. The drive keys
 * are what suffer, since driving is what the operator does next.
 *
 * Pointer interaction only. Tabbing to a control still focuses it and still
 * shows its ring, which is the whole point of a focus ring. Text fields keep
 * focus too, or clicking into one to type would immediately undo itself.
 */
function useNoStuckFocus() {
  useEffect(() => {
    const drop = () => {
      const el = document.activeElement as HTMLElement | null
      if (!el || el === document.body || isTextEntry(el)) return
      el.blur()
    }
    // click fires after pointerup, so the blur is deferred a tick and the
    // control gets its activation before it loses focus.
    let queued: ReturnType<typeof setTimeout> | null = null
    const onUp = () => {
      if (queued) clearTimeout(queued)
      queued = setTimeout(drop, 0)
    }
    window.addEventListener('pointerup', onUp)
    return () => {
      if (queued) clearTimeout(queued)
      window.removeEventListener('pointerup', onUp)
    }
  }, [])
}

function Workspace() {
  useNoStuckFocus()
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('actions')
  const Active = TABS.find((t) => t.key === tab)!.Panel

  return (
    <div className="app">
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

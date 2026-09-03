import { useEffect, useRef, useState } from 'react'
import { useRobot, useTelemetry } from '../state/RobotContext'
import { ACTIONS, ACTION_GROUPS, type ActionSpec } from '../lib/constants'
import { actionIconSvg } from '../lib/actionIcons'
import { SPORT_CMD, SPORT_CMD_MCF } from '../lib/constants'
import { clearsEverything, staysLit } from '../lib/actionKinds'
import { freshGrid, reduce, tilePhase, type Phase } from '../lib/actionPhases'
import type { Availability } from '../lib/actionAvailability'

/** How long a refusal stays on the tile before it goes quiet again. */
const FAIL_MS = 5000

/**
 * Tooltip text: what the action does, then whatever the operator needs to know
 * before pressing it, and the api id last for anyone reading the protocol.
 */
function describe(a: ActionSpec, stands: Availability, phase: Phase, reason?: string): string {
  const parts = [a.note ?? a.label]
  // A failure the operator just caused outranks a caveat about the id.
  if (phase === 'failed' && reason) parts.push(reason)
  else if (stands.why) parts.push(stands.why)
  else if (staysLit(a.kind)) parts.push(phase === 'on' ? 'Press again to stop.' : 'Stays on until pressed again.')
  if (stands.apiId !== null) parts.push(`api ${stands.apiId}`)
  return parts.join(' · ')
}

export default function ActionsPanel() {
  const { connState, motion, log } = useRobot()
  const { mode: motionMode, runAction, sport, availabilityOf, posing, setPosing } = motion
  const { sportState } = useTelemetry()
  const connected = connState === 'connected'

  /**
   * Everything a tile shows lives behind lib/actionPhases.ts: what a press,
   * an answer, or a telemetry frame does to the grid is one tested reducer,
   * and this panel only forwards events and renders tilePhase(). The rules -
   * operator action outranks telemetry, telemetry outranks optimism - used to
   * be branches in here, where nothing could pin them down.
   */
  const [grid, setGrid] = useState(freshGrid)
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  // A dropped link, or a different motion service, invalidates everything this
  // panel believes about the robot. Start again rather than showing a stale on.
  useEffect(() => {
    setGrid(freshGrid())
  }, [connected, motionMode])

  useEffect(() => {
    if (!connected || !sportState) return
    setGrid((g) => reduce(g, { kind: 'report', state: sportState, motionMode }))
  }, [connected, sportState, motionMode])

  useEffect(() => {
    const t = timers.current
    return () => Object.values(t).forEach(clearTimeout)
  }, [])

  const fire = (a: ActionSpec) => {
    // Pose shares its state with the drive loop, so it has its own send.
    if (a.kind === 'pose') {
      void togglePose()
      return
    }

    const next = staysLit(a.kind) ? tilePhase(grid, a.name) !== 'on' : true
    setGrid((g) => reduce(g, { kind: 'pressed', name: a.name }))
    clearTimeout(timers.current[a.name])

    runAction(a, next)
      .then(() => {
        setGrid((g) => reduce(g, { kind: 'accepted', name: a.name, on: next }))
        // Settling ends pose mode too, and pose lives with the drive loop.
        if (clearsEverything(a.kind)) setPosing(false)
        log(`${a.label}${staysLit(a.kind) ? (next ? ' on' : ' off') : ''} - the robot accepted it`)
      })
      .catch((e) => {
        const message = (e as Error).message
        setGrid((g) => reduce(g, { kind: 'refused', name: a.name, message }))
        timers.current[a.name] = setTimeout(() => setGrid((g) => reduce(g, { kind: 'faded', name: a.name })), FAIL_MS)
        log(`${a.label} failed: ${message}`)
      })
  }

  const togglePose = async () => {
    const ids = motionMode === 'mcf' ? SPORT_CMD_MCF : SPORT_CMD
    try {
      if (!posing) {
        await sport(ids.Pose, { data: true })
        setPosing(true)
        log('Pose mode on - the walk and turn sticks now lean the body')
      } else {
        // Leaving pose first stops the loop sending attitude frames, so the
        // StopMove that actually exits the mode is the last thing on the wire.
        setPosing(false)
        await sport(SPORT_CMD.StopMove)
        log('Pose mode off')
      }
    } catch (e) {
      setPosing(false)
      log(`Pose mode: ${(e as Error).message}`)
    }
  }

  return (
    <div className="section">
      {ACTION_GROUPS.map((group) => {
        const items = ACTIONS.filter((a) => a.group === group.key)
        if (!items.length) return null
        return (
          <div key={group.key} className="mb-7">
            <p className="eyebrow">{group.label}</p>
            <p className="note">{group.note}</p>
            <div className="btn-grid">
              {items.map((a) => {
                const stands = availabilityOf(a)
                const unavailable = !stands.usable
                const untested = connected && stands.untested
                // Pose mode is shared state - the drive loop reads it too - so
                // it comes from the context rather than the grid reducer.
                const p: Phase = a.kind === 'pose' ? (posing ? 'on' : 'idle') : tilePhase(grid, a.name)
                const icon = actionIconSvg(a.name)
                return (
                  <button
                    key={a.name}
                    className={[
                      'btn action',
                      p === 'on' ? 'on' : '',
                      p === 'pending' ? 'running' : '',
                      p === 'failed' ? 'failed' : '',
                      unavailable ? 'unavailable' : '',
                      untested ? 'untested' : '',
                    ].filter(Boolean).join(' ')}
                    aria-pressed={staysLit(a.kind) ? p === 'on' : undefined}
                    aria-busy={p === 'pending' || undefined}
                    disabled={!connected || unavailable || p === 'pending'}
                    title={describe(a, stands, p, grid.reason[a.name])}
                    // Clicking a tile left the focus ring on it afterwards, so
                    // a pressed action looked stuck. Suppressing focus on
                    // pointer press keeps the ring for Tab, where it is needed,
                    // and off the mouse, where it only reads as stuck.
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => fire(a)}
                  >
                    {p === 'pending' && <span className="action-busy" />}
                    {icon && <span className="action-icon" dangerouslySetInnerHTML={{ __html: icon }} />}
                    <span className="action-label">{a.label}</span>
                    {a.risky && <span className="badge">!</span>}
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}

      <p className="note mt-4">
        <span className="badge">!</span> needs clear, soft floor. Dashed means the {motionMode} service does not list it -
        it is still worth a try, and the robot will say if it cannot.
      </p>
    </div>
  )
}

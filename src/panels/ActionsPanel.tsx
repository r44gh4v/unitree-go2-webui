import { useCallback, useEffect, useRef, useState } from 'react'
import { useRobot } from '../state/RobotContext'
import { ACTIONS, ACTION_GROUPS, type ActionSpec } from '../lib/actions'
import { actionIconSvg } from '../lib/actionIcons'
import { SPORT_CMD, SPORT_CMD_MCF } from '../lib/constants'
import { clearsEverything, isExclusive, staysLit } from '../lib/actionKinds'

/** How long a refusal stays on the tile before it goes quiet again. */
const FAIL_MS = 5000

type Phase = 'idle' | 'pending' | 'on' | 'failed'

/**
 * Tooltip text: what the action does, then whatever the operator needs to know
 * before pressing it, and the api id last for anyone reading the protocol.
 */
function describe(
  a: ActionSpec,
  resolved: { apiId: number; exact: boolean; from: string } | null,
  mode: string,
  phase: Phase,
  reason?: string,
): string {
  const parts = [a.note ?? a.label]
  if (!resolved) parts.push('No command id is known for this action.')
  else if (phase === 'failed' && reason) parts.push(reason)
  else if (!resolved.exact) {
    parts.push(`The ${mode} service does not list this. Sends the ${resolved.from} id, and the robot may refuse it.`)
  } else if (staysLit(a.kind)) parts.push(phase === 'on' ? 'Press again to stop.' : 'Stays on until pressed again.')
  if (resolved) parts.push(`api ${resolved.apiId}`)
  return parts.join(' · ')
}

export default function ActionsPanel() {
  const { connState, motion, log } = useRobot()
  const { mode: motionMode, runAction, sport, apiIdFor, posing, setPosing } = motion
  const connected = connState === 'connected'
  const [phase, setPhase] = useState<Record<string, Phase>>({})
  const [reason, setReason] = useState<Record<string, string>>({})
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  // A dropped link, or a different motion service, invalidates everything this
  // panel believes about the robot. Start again rather than showing a stale on.
  useEffect(() => {
    setPhase({})
    setReason({})
  }, [connected, motionMode])

  useEffect(() => {
    const t = timers.current
    return () => Object.values(t).forEach(clearTimeout)
  }, [])

  const settle = useCallback((name: string, next: Phase, why?: string) => {
    setPhase((p) => ({ ...p, [name]: next }))
    if (why) setReason((r) => ({ ...r, [name]: why }))
    clearTimeout(timers.current[name])
    if (next === 'failed') {
      timers.current[name] = setTimeout(() => setPhase((p) => ({ ...p, [name]: 'idle' })), FAIL_MS)
    }
  }, [])

  const fire = (a: ActionSpec) => {
    // Pose shares its state with the drive loop, so it has its own send.
    if (a.kind === 'pose') {
      void togglePose()
      return
    }

    const wasOn = phase[a.name] === 'on'
    const next = staysLit(a.kind) ? !wasOn : true
    setPhase((p) => ({ ...p, [a.name]: 'pending' }))

    runAction(a, next)
      .then(() => {
        if (clearsEverything(a.kind)) {
          // Back to standing or resting: nothing is running any more, so no
          // tile should still claim to be.
          setPhase({})
          setPosing(false)
        } else if (isExclusive(a.kind) && next) {
          // The robot walks one way at a time, so lighting a gait releases the
          // others rather than leaving two lit.
          setPhase((p) => {
            const out = { ...p }
            for (const other of ACTIONS) {
              if (isExclusive(other.kind) && other.name !== a.name) out[other.name] = 'idle'
            }
            out[a.name] = 'on'
            return out
          })
        } else {
          settle(a.name, staysLit(a.kind) && next ? 'on' : 'idle')
        }
        log(`${a.label}${staysLit(a.kind) ? (next ? ' on' : ' off') : ''} - the robot accepted it`)
      })
      .catch((e) => {
        const message = (e as Error).message
        // 4206 is the robot saying the posture is wrong for this move, which is
        // almost always cured by standing up first - say so rather than echoing.
        const hint = message.includes('4206') ? `${message} Try Stand up first.` : message
        settle(a.name, 'failed', hint)
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
          <div key={group.key} style={{ marginBottom: 20 }}>
            <p className="eyebrow">{group.label}</p>
            <p className="note">{group.note}</p>
            <div className="btn-grid">
              {items.map((a) => {
                const resolved = apiIdFor(a)
                // Only genuinely unknown actions are blocked. One the running
                // service does not list is still offered, marked untested, and
                // the robot gets to be the one that says no.
                const unavailable = !resolved
                const untested = connected && !!resolved && !resolved.exact
                // Pose mode is shared state - the drive loop reads it too - so
                // it comes from the context rather than this panel's own map.
                const p: Phase = a.kind === 'pose' ? (posing ? 'on' : 'idle') : (phase[a.name] ?? 'idle')
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
                    title={describe(a, resolved, motionMode, p, reason[a.name])}
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

      <p className="note" style={{ marginTop: 10 }}>
        <span className="badge">!</span> needs clear, soft floor. Dashed means the {motionMode} service does not list it -
        it is still worth a try, and the robot will say if it cannot.
      </p>
    </div>
  )
}

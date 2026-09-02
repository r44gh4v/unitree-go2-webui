import { useCallback, useEffect, useRef, useState } from 'react'
import { useRobot, useTelemetry } from '../state/RobotContext'
import { ACTIONS, ACTION_GROUPS, type ActionSpec } from '../lib/constants'
import { actionIconSvg } from '../lib/actionIcons'
import { SPORT_CMD, SPORT_CMD_MCF } from '../lib/constants'
import { clearsEverything, isExclusive, staysLit } from '../lib/actionKinds'
import { actionNameFor, decodeMotionState, TRACKED_ACTION_NAMES } from '../lib/motionState'
import type { Availability } from '../lib/actionAvailability'

/** How long a refusal stays on the tile before it goes quiet again. */
const FAIL_MS = 5000

type Phase = 'idle' | 'pending' | 'on' | 'failed'

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
  const [phase, setPhase] = useState<Record<string, Phase>>({})
  const [reason, setReason] = useState<Record<string, string>>({})
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  /**
   * What the robot itself reports as running, translated to a tile name -
   * lib/motionState.ts. `phase` is left to carry only what this panel just
   * did (pending, failed); whether a staysLit tile is actually *on* is a
   * question telemetry answers, not something a successful send gets to
   * assert on its own. A mode that engaged silently used to look identical to
   * one that never fired, because both just left the tile however the last
   * click set it.
   */
  const [engaged, setEngaged] = useState<string | null>(null)
  const mcfLastState = useRef('freeWalk')

  const isOn = useCallback((name: string) => engaged === name || phase[name] === 'on', [engaged, phase])

  // A dropped link, or a different motion service, invalidates everything this
  // panel believes about the robot. Start again rather than showing a stale on.
  useEffect(() => {
    setPhase({})
    setReason({})
    setEngaged(null)
    mcfLastState.current = 'freeWalk'
  }, [connected, motionMode])

  useEffect(() => {
    if (!connected || !sportState) return
    const { state, mcfLastState: next } = decodeMotionState(sportState, motionMode, mcfLastState.current)
    mcfLastState.current = next
    const name = actionNameFor(state)
    setEngaged((prev) => (prev === name ? prev : name))
  }, [connected, sportState, motionMode])

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

    const wasOn = isOn(a.name)
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
          // others rather than leaving two lit. Every other exclusive tile's
          // optimism is cleared unconditionally - telemetry may have nothing
          // to say about the gait that just stopped, so nothing else will.
          setPhase((p) => {
            const out = { ...p }
            for (const other of ACTIONS) {
              if (isExclusive(other.kind) && other.name !== a.name) out[other.name] = 'idle'
            }
            // Telemetry can identify most gaits and is authority for those;
            // only the plain walk/run tiles it cannot tell apart still rely
            // on this optimistic mark.
            out[a.name] = TRACKED_ACTION_NAMES.has(a.name) ? 'idle' : 'on'
            return out
          })
        } else {
          const showOn = staysLit(a.kind) && next && !TRACKED_ACTION_NAMES.has(a.name)
          settle(a.name, showOn ? 'on' : 'idle')
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
          <div key={group.key} className="mb-7">
            <p className="eyebrow">{group.label}</p>
            <p className="note">{group.note}</p>
            <div className="btn-grid">
              {items.map((a) => {
                const stands = availabilityOf(a)
                const unavailable = !stands.usable
                const untested = connected && stands.untested
                // Pose mode is shared state - the drive loop reads it too - so
                // it comes from the context rather than this panel's own map.
                // pending/failed are what this panel just did and outrank
                // telemetry; otherwise isOn() decides, not the raw phase map.
                const rawPhase = phase[a.name]
                const p: Phase =
                  a.kind === 'pose' ? (posing ? 'on' : 'idle')
                    : rawPhase === 'pending' || rawPhase === 'failed' ? rawPhase
                      : isOn(a.name) ? 'on' : 'idle'
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
                    title={describe(a, stands, p, reason[a.name])}
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

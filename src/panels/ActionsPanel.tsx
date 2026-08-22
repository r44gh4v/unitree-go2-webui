import { useState } from 'react'
import { useRobot } from '../state/RobotContext'
import { ACTIONS, ACTION_GROUPS, SPORT_QUERIES, type ActionSpec } from '../lib/actions'
import { actionIconSvg } from '../lib/actionIcons'
import { unwrapResponse } from '../lib/go2'
import { AlertIcon } from '../components/Icons'

/**
 * Tooltip text: what the action does, then whatever the operator needs to know
 * before pressing it, and the api id last for anyone reading the protocol.
 */
function describe(a: ActionSpec, apiId: number | null, blocked: boolean, on: boolean): string {
  const parts = [a.note ?? a.label]
  if (blocked) parts.push('Turn on dynamic moves to use this.')
  else if (a.toggle) parts.push(on ? 'Press again to stop.' : 'Stays on until pressed again.')
  if (apiId !== null) parts.push(`api ${apiId}`)
  return parts.join(' · ')
}

export default function ActionsPanel() {
  const { connState, motionMode, armed, setArmed, runAction, sport, apiIdFor, log } = useRobot()
  const connected = connState === 'connected'
  const [toggles, setToggles] = useState<Record<string, boolean>>({})
  const [pending, setPending] = useState<Record<string, boolean>>({})
  const [queryResult, setQueryResult] = useState<string | null>(null)

  const fire = (name: string) => {
    const action = ACTIONS.find((a) => a.name === name)!
    const next = action.toggle ? !toggles[name] : true
    setPending((p) => ({ ...p, [name]: true }))
    runAction(action, next)
      .then(() => {
        if (action.toggle) setToggles((t) => ({ ...t, [name]: next }))
        log(`${action.label}${action.toggle ? (next ? ' on' : ' off') : ''} - accepted`)
      })
      .catch((e) => log(`${action.label} failed: ${(e as Error).message}`))
      .finally(() => setPending((p) => ({ ...p, [name]: false })))
  }

  const runQuery = (label: string, apiId: number, parameter?: unknown) => {
    sport(apiId, parameter)
      .then((res) => {
        const value = unwrapResponse(res)
        setQueryResult(`${label}: ${typeof value === 'string' ? value : JSON.stringify(value, null, 1)}`)
      })
      .catch((e) => setQueryResult(`${label} failed: ${(e as Error).message}`))
  }

  return (
    <div className="section">
      <div
        
        style={{
          border: `1px solid ${armed ? 'var(--warn)' : 'var(--line)'}`,
          borderRadius: 'var(--radius)',
          padding: 10,
          marginBottom: 14,
        }}
      >
        <label className={`toggle${armed ? ' on' : ''}`} title="Unlock flips, jumps, and handstands; keep off unless there is clear space">
          <span className="toggle-label">
            <AlertIcon size={15} />
            Allow dynamic moves
          </span>
          <input
            type="checkbox"
            checked={armed}
            disabled={!connected}
            onChange={(e) => setArmed(e.target.checked)}
            style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }}
          />
          <span className="track" />
        </label>
        <p className="note" style={{ marginBottom: 0 }}>
          Flips, jumps, and handstands can damage the robot or injure someone nearby. Give it two metres of clear
          space on a soft, level floor before turning this on.
        </p>
      </div>

      {ACTION_GROUPS.map((group) => {
        const items = ACTIONS.filter((a) => a.group === group.key && a.ids[motionMode] !== undefined)
        if (!items.length) return null
        return (
          <div key={group.key} style={{ marginBottom: 16 }}>
            <p className="eyebrow">{group.label}</p>
            <div className="btn-grid">
              {items.map((a) => {
                const blocked = !!a.risky && !armed
                const on = a.toggle && toggles[a.name]
                const icon = actionIconSvg(a.name)
                return (
                  <button
                    key={a.name}
                    className={`btn action${on ? ' primary' : ''}${pending[a.name] ? ' running' : ''}`}
                    disabled={!connected || blocked || !!pending[a.name]}
                    title={describe(a, apiIdFor(a), blocked, !!on)}
                    onClick={() => fire(a.name)}
                  >
                    {pending[a.name] && <span className="action-busy" />}
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

      {ACTIONS.every((a) => a.ids[motionMode] === undefined) && (
        <p className="note warn">No actions are mapped for {motionMode} mode.</p>
      )}

      <div style={{ marginBottom: 16 }}>
        <p className="eyebrow">Read state</p>
        <div className="btn-grid">
          {SPORT_QUERIES.map((q) => (
            <button key={q.label} className="btn" disabled={!connected} title={`Read the robot's current ${q.label.toLowerCase()}`} onClick={() => runQuery(q.label, q.apiId, q.parameter)}>
              {q.label}
            </button>
          ))}
        </div>
        {queryResult && (
          <pre className="log" style={{ marginTop: 8, maxHeight: 160 }}>
            {queryResult}
          </pre>
        )}
      </div>
    </div>
  )
}

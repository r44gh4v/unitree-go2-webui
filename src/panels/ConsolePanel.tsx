import { useEffect, useRef, useState } from 'react'
import { useRobot } from '../state/RobotContext'
import { SUBSCRIBABLE_TOPICS, TOPICS } from '../lib/constants'
import { API_CATALOG } from '../lib/apiCatalog'

/** Raw protocol view: message log, topic subscriptions, and a hand-built request sender. */
export default function ConsolePanel() {
  const { conn, diagnostics, connState, link, log } = useRobot()
  const { traffic, clearTraffic } = diagnostics
  const linkStats = link.stats
  const connected = connState === 'connected'
  const logRef = useRef<HTMLDivElement>(null)
  const [follow, setFollow] = useState(true)
  const [filter, setFilter] = useState('')

  const [topic, setTopic] = useState<string>(TOPICS.SPORT_MOD)
  const [apiId, setApiId] = useState('1016')
  const [parameter, setParameter] = useState('')
  const [result, setResult] = useState<string | null>(null)
  const [apiSearch, setApiSearch] = useState('')

  const matchingApis = (() => {
    const q = apiSearch.trim().toLowerCase()
    if (!q) return []
    return API_CATALOG.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        String(e.apiId).includes(q) ||
        e.group.toLowerCase().includes(q) ||
        e.topic.toLowerCase().includes(q),
    ).slice(0, 60)
  })()

  const [watched, setWatched] = useState<Record<string, unknown>>({})
  const [watching, setWatching] = useState<string[]>([])
  // The unsubscribe callbacks live in a ref: holding them in state would make
  // the unmount cleanup re-run on every toggle and drop the other watchers.
  const unsubs = useRef<Record<string, () => void>>({})

  useEffect(() => {
    if (follow && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [traffic, follow])

  // drop every subscription this panel owns, but only when it unmounts
  useEffect(
    () => () => {
      Object.values(unsubs.current).forEach((u) => u())
      unsubs.current = {}
    },
    [],
  )

  const toggleSub = (t: string) => {
    if (unsubs.current[t]) {
      unsubs.current[t]()
      delete unsubs.current[t]
      setWatching((w) => w.filter((x) => x !== t))
      setWatched((w) => {
        const copy = { ...w }
        delete copy[t]
        return copy
      })
    } else {
      unsubs.current[t] = conn.subscribe(t, (data) => setWatched((w) => ({ ...w, [t]: data })))
      setWatching((w) => [...w, t])
    }
  }

  const sendRequest = async () => {
    const id = Number(apiId)
    if (!Number.isFinite(id)) {
      setResult('API id must be a number.')
      return
    }
    let param: unknown
    if (parameter.trim()) {
      try {
        param = JSON.parse(parameter)
      } catch {
        param = parameter
      }
    }
    setResult('Waiting for the robot…')
    try {
      const res = await conn.request(topic, id, param)
      setResult(JSON.stringify(res, null, 2))
    } catch (e) {
      setResult(`Failed: ${(e as Error).message}`)
    }
  }

  const visible = filter
    ? traffic.filter((t) => t.text.toLowerCase().includes(filter.toLowerCase()))
    : traffic

  return (
    <div className="section">
      <p className="eyebrow">Command catalogue</p>
      <p className="note">Picking one fills the form below</p>
      <input
        className="input"
        title="Search every documented command; click a result to fill the form"
        placeholder="Search by name or id"
        value={apiSearch}
        onChange={(e) => setApiSearch(e.target.value)}
        style={{ marginBottom: 8 }}
      />
      {apiSearch.trim() && (
        <div style={{ maxHeight: 240, overflowY: 'auto', marginBottom: 10 }}>
          {matchingApis.length === 0 && <p className="note">Nothing matches that</p>}
          {matchingApis.map((e) => (
            <button
              key={`${e.group}-${e.name}-${e.apiId}`}
              className="btn sm block"
              style={{ justifyContent: 'space-between', marginBottom: 4 }}
              title={e.note ?? e.topic}
              onClick={() => {
                setTopic(e.topic)
                setApiId(String(e.apiId))
                setParameter(e.parameter === undefined ? '' : JSON.stringify(e.parameter))
                setApiSearch('')
              }}
            >
              <span>{e.name}</span>
              <span style={{ fontSize: 10, color: 'var(--muted)' }}>
                {e.tag} · {e.apiId}
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="divider" />
      <p className="eyebrow">Send a request</p>
      <p className="note">Sent as-is</p>

      <div className="field">
        <label htmlFor="topic">Topic</label>
        <input id="topic" className="input" title="The rt/... topic the request is sent to" value={topic} onChange={(e) => setTopic(e.target.value)} list="known-topics" />
        <datalist id="known-topics">
          {Object.values(TOPICS).map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
      </div>

      <div className="field">
        <label htmlFor="apiid">API id</label>
        <input id="apiid" className="input" title="The numeric API id for the command" value={apiId} onChange={(e) => setApiId(e.target.value)} inputMode="numeric" />
      </div>

      <div className="field">
        <label htmlFor="param">Parameter (JSON)</label>
        <textarea
          id="param"
          className="input"
          title="Optional JSON parameter; sent as a string on the wire"
          value={parameter}
          onChange={(e) => setParameter(e.target.value)}
          placeholder='{"x": 0.3, "y": 0, "z": 0}'
        />
      </div>

      <div className="btn-row">
        <button className="btn primary" disabled={!connected} title="Send this request to the robot and show its reply" onClick={sendRequest}>
          Send
        </button>
        <button className="btn ghost" title="Clear the reply below" onClick={() => setResult(null)} disabled={!result}>
          Clear reply
        </button>
      </div>

      {result && (
        <pre className="log" style={{ marginTop: 8, maxHeight: 220 }}>
          {result}
        </pre>
      )}

      <div className="divider" />
      <p className="eyebrow">Watch topics</p>
      <p className="note">Streams live values. High-rate topics are noted.</p>

      {SUBSCRIBABLE_TOPICS.map((t) => {
        const on = watching.includes(t.topic)
        return (
          <div key={t.topic} style={{ marginBottom: 6 }}>
            <button
              className={`btn sm block${on ? ' on' : ''}`}
              style={{ justifyContent: 'space-between' }}
              disabled={!connected}
              title={on ? `Stop watching ${t.topic}` : `${t.note} (${t.topic})`}
              onClick={() => toggleSub(t.topic)}
            >
              <span>{t.label}</span>
              <span style={{ fontSize: 10, opacity: 0.7 }}>{on ? 'watching' : t.topic}</span>
            </button>
            {on && watched[t.topic] !== undefined && (
              <pre className="log" style={{ maxHeight: 140, marginTop: 4 }}>
                {JSON.stringify(watched[t.topic], null, 1).slice(0, 4000)}
              </pre>
            )}
          </div>
        )
      })}

      <div className="divider" />
      <p className="eyebrow">Message log</p>

      <div className="btn-row" style={{ marginBottom: 8 }}>
        <input
          className="input"
          style={{ flex: 1, minWidth: 120 }}
          placeholder="Filter"
          title="Show only log lines containing this text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <button className={`btn sm${follow ? ' on' : ''}`} title="Keep the log scrolled to the newest message" onClick={() => setFollow((f) => !f)}>
          Follow
        </button>
        <button className="btn sm ghost" title="Empty the message log" onClick={clearTraffic}>
          Clear
        </button>
      </div>

      <p className="note">
        {linkStats.messages.toLocaleString()} messages · {(linkStats.bytes / 1024).toFixed(0)} KB ·{' '}
        {linkStats.topics} topics subscribed
      </p>

      <div ref={logRef} className="log" style={{ height: 300 }}>
        {visible.length === 0 && <div className="meta">Nothing logged yet.</div>}
        {visible.map((t, i) => (
          <div key={i} className={t.dir === 'in' ? 'in' : t.dir === 'out' ? 'out' : 'meta'}>
            <span className="meta">{new Date(t.ts).toLocaleTimeString()} </span>
            {t.dir === 'in' ? '< ' : t.dir === 'out' ? '> ' : '· '}
            {t.text}
          </div>
        ))}
      </div>

      <div className="btn-row" style={{ marginTop: 8 }}>
        <button
          className="btn sm ghost"
          title="Copy the whole message log to the clipboard"
          onClick={() => {
            const text = traffic.map((t) => `${new Date(t.ts).toISOString()} ${t.dir} ${t.text}`).join('\n')
            void navigator.clipboard.writeText(text).then(
              () => log('Log copied to the clipboard.'),
              () => log('Could not reach the clipboard.'),
            )
          }}
          disabled={!traffic.length}
        >
          Copy log
        </button>
      </div>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { useRobot } from '../state/RobotContext'
import { MOTION_MODE_OPTIONS } from '../lib/constants'
import type { CloudRobot, ConnectMethod, DiscoveredRobot } from '../lib/types'
import { AlertIcon, CheckIcon, PlugIcon, ScanIcon } from '../components/Icons'

const STORE = {
  method: 'go2.method',
  ip: 'go2.lastIp',
  serial: 'go2.serial',
  key: 'go2.aesKey',
  email: 'go2.email',
  region: 'go2.region',
  route: 'go2.route',
}

const METHODS: { value: ConnectMethod; label: string; blurb: string }[] = [
  { value: 'ip', label: 'IP', blurb: 'On this network, address known.' },
  { value: 'serial', label: 'Serial', blurb: 'On this network, found by serial number.' },
  { value: 'ap', label: 'AP', blurb: "Joined the robot's own Wi-Fi hotspot." },
  { value: 'cloud', label: 'Cloud', blurb: 'Signed in like the phone app. Works anywhere.' },
]

export default function ConnectPanel() {
  const {
    connState, connError, connect, disconnect, retry,
    motionMode, setMotionMode, reportedMode, refreshMotionMode, switchMotionMode, log,
  } = useRobot()

  const [method, setMethod] = useState<ConnectMethod>(() => {
    // Guard against a method saved by an older build (e.g. a removed one).
    const saved = localStorage.getItem(STORE.method) as ConnectMethod
    return METHODS.some((m) => m.value === saved) ? saved : 'ip'
  })
  const [ip, setIp] = useState(() => localStorage.getItem(STORE.ip) ?? '192.168.12.1')
  const [serial, setSerial] = useState(() => localStorage.getItem(STORE.serial) ?? '')
  const [aesKey, setAesKey] = useState(() => localStorage.getItem(STORE.key) ?? '')
  const [showKey, setShowKey] = useState(false)

  const [email, setEmail] = useState(() => localStorage.getItem(STORE.email) ?? '')
  const [password, setPassword] = useState('')
  const [region, setRegion] = useState(() => localStorage.getItem(STORE.region) ?? 'global')
  const [token, setToken] = useState('')
  const [cloudRobots, setCloudRobots] = useState<CloudRobot[] | null>(null)
  const [pickedSerial, setPickedSerial] = useState('')
  const [signingIn, setSigningIn] = useState(false)

  // Cloud method: look for the robot on the server's own network first and
  // connect directly when it answers, instead of relaying everything.
  const [preferLocal, setPreferLocal] = useState(() => localStorage.getItem(STORE.route) !== 'relay')

  const [scanning, setScanning] = useState(false)
  const [found, setFound] = useState<DiscoveredRobot[]>([])
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(true)
  // outcome of the last scan or sign-in, shown right here in the panel
  const [note, setNote] = useState<string | null>(null)

  const connected = connState === 'connected'
  const connecting = connState === 'connecting' || connState === 'validating'
  const locked = connected || connecting

  // Once the link is up this panel is done doing its job; get out of the way.
  useEffect(() => {
    if (connected) {
      setOpen(false)
      void refreshMotionMode().catch(() => undefined)
    } else {
      setOpen(true)
    }
  }, [connected, refreshMotionMode])

  useEffect(() => localStorage.setItem(STORE.method, method), [method])

  const doConnect = async () => {
    setBusy(true)
    try {
      localStorage.setItem(STORE.ip, ip.trim())
      localStorage.setItem(STORE.serial, serial.trim())
      localStorage.setItem(STORE.region, region)
      if (aesKey.trim()) localStorage.setItem(STORE.key, aesKey.trim())
      localStorage.setItem(STORE.route, preferLocal ? 'auto' : 'relay')
      await connect({
        method,
        ip: ip.trim(),
        serial: method === 'cloud' ? pickedSerial : serial.trim(),
        aesKey: aesKey.trim(),
        token,
        region,
        route: preferLocal ? 'auto' : 'relay',
      })
    } catch (e) {
      log(`Connection failed: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  const doScan = async () => {
    setScanning(true)
    setFound([])
    setNote(null)
    try {
      const res = await fetch('/api/discover')
      const body = (await res.json()) as { robots?: DiscoveredRobot[]; error?: string }
      if (!res.ok) throw new Error(body.error ?? `Scan failed with HTTP ${res.status}`)
      setFound(body.robots ?? [])
      if (body.robots?.length) log(`Found ${body.robots.length} robot(s).`)
      else setNote('No robots answered on this network.')
    } catch (e) {
      setNote(`Scan failed: ${(e as Error).message}`)
    } finally {
      setScanning(false)
    }
  }

  const doSignIn = async () => {
    setSigningIn(true)
    setNote(null)
    try {
      localStorage.setItem(STORE.email, email.trim())
      const res = await fetch('/api/cloud/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password, region }),
      })
      const body = (await res.json()) as { token?: string; robots?: CloudRobot[]; error?: string }
      if (!res.ok || body.error) throw new Error(body.error ?? `HTTP ${res.status}`)
      setToken(body.token ?? '')
      setCloudRobots(body.robots ?? [])
      setPassword('')
      if (body.robots?.length) {
        setPickedSerial(body.robots[0].sn)
        if (body.robots[0].aesKey && !aesKey) setAesKey(body.robots[0].aesKey)
        log(`Signed in. ${body.robots.length} robot(s) on this account.`)
      } else {
        setNote('Signed in, but no robots are bound to this account.')
      }
    } catch (e) {
      setNote(`Sign in failed: ${(e as Error).message}`)
      setCloudRobots(null)
    } finally {
      setSigningIn(false)
    }
  }

  const canConnect =
    method === 'ip' ? !!ip.trim()
      : method === 'serial' ? !!serial.trim()
        : method === 'ap' ? true
          : !!token && !!pickedSerial

  const methodLabel = METHODS.find((m) => m.value === method)?.label ?? method
  const where = method === 'cloud' ? pickedSerial : method === 'serial' ? serial : ip

  // The form is only useful when you can act on it: hide it while a link is up
  // or being established, keep it visible when idle or after a failure.
  const showForm = open && !connecting

  const badgeLabel =
    connState === 'connected' ? 'Linked'
      : connState === 'connecting' ? 'Connecting'
        : connState === 'validating' ? 'Auth'
          : connState === 'error' ? 'Failed'
            : 'Offline'

  return (
    <>
      <div className={`section conn conn-${connState}`}>
        <div className="conn-status">
          <span className={`pill pill-${connState}`}>
            {connecting ? <span className="spinner sm" />
              : connected ? <CheckIcon size={12} />
                : connState === 'error' ? <AlertIcon size={12} />
                  : <PlugIcon size={12} />}
            {badgeLabel}
          </span>
          <div className="conn-text">
            <span className="conn-sub" title={connState === 'error' ? (connError ?? undefined) : undefined}>
              {connState === 'connected' ? `${where} · ${methodLabel}`
                : connState === 'connecting' ? `Reaching ${where || 'the robot'}…`
                  : connState === 'validating' ? 'Exchanging keys'
                    : connState === 'error' ? (connError ?? 'Unknown error')
                      : 'Choose a method and connect'}
            </span>
          </div>

          {connected && (
            <button className="btn sm danger" title="Close the link" onClick={disconnect}>
              Disconnect
            </button>
          )}
          {connecting && (
            <button className="btn sm ghost" title="Stop trying to connect" onClick={disconnect}>
              Cancel
            </button>
          )}
          {connState === 'error' && retry && (
            <button className="btn sm" title="Try the same connection again" onClick={retry}>
              Retry
            </button>
          )}
          {(connected || connState === 'error') && (
            <button className="btn sm ghost" title={showForm ? 'Hide the settings' : 'Change the connection'} onClick={() => setOpen((v) => !v)} aria-expanded={showForm}>
              {showForm ? 'Hide' : 'Change'}
            </button>
          )}
        </div>

        {showForm && (
          <>
            <div className="seg" role="tablist" aria-label="Connection method">
              {METHODS.map((m) => (
                <button
                  key={m.value}
                  role="tab"
                  aria-selected={method === m.value}
                  className={`seg-btn${method === m.value ? ' active' : ''}`}
                  disabled={locked}
                  title={m.blurb}
                  onClick={() => setMethod(m.value)}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <p className="note">{METHODS.find((m) => m.value === method)?.blurb}</p>

            {method === 'ip' && (
              <div className="field">
                <label htmlFor="ip">Robot address</label>
                <input
                  id="ip"
                  className="input"
                  value={ip}
                  onChange={(e) => setIp(e.target.value)}
                  placeholder="192.168.1.42"
                  disabled={locked}
                  onKeyDown={(e) => e.key === 'Enter' && !locked && canConnect && void doConnect()}
                />
              </div>
            )}

            {method === 'serial' && (
              <div className="field">
                <label htmlFor="sn">Serial number</label>
                <input
                  id="sn"
                  className="input"
                  value={serial}
                  onChange={(e) => setSerial(e.target.value)}
                  placeholder="B42D2000XXXXXXXX"
                  disabled={locked}
                />
              </div>
            )}


            {method === 'ap' && (
              <p className="note">
                Join the Wi-Fi network named after the robot's serial, then connect. Your laptop loses internet while
                joined to it.
              </p>
            )}

            {method === 'cloud' && !token && (
              <>
                <div className="field">
                  <label htmlFor="region">Region</label>
                  <select id="region" className="input" value={region} onChange={(e) => setRegion(e.target.value)}>
                    <option value="global">Global</option>
                    <option value="cn">China</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="email">Email</label>
                  <input id="email" className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="pw">Password</label>
                  <input
                    id="pw"
                    className="input"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && email && password && void doSignIn()}
                  />
                </div>
                <button className="btn block" onClick={doSignIn} disabled={signingIn || !email || !password}>
                  {signingIn ? 'Signing in…' : 'Sign in'}
                </button>
              </>
            )}

            {method === 'cloud' && token && !!cloudRobots?.length && (
              <div className="field">
                <label htmlFor="robot">Robot</label>
                <select
                  id="robot"
                  className="input"
                  value={pickedSerial}
                  disabled={locked}
                  onChange={(e) => {
                    setPickedSerial(e.target.value)
                    const r = cloudRobots?.find((x) => x.sn === e.target.value)
                    if (r?.aesKey) setAesKey(r.aesKey)
                  }}
                >
                  {(cloudRobots ?? []).map((r) => (
                    <option key={r.sn} value={r.sn}>
                      {r.name ? `${r.name} - ${r.sn}` : r.sn}
                    </option>
                  ))}
                </select>
                <label
                  className={`toggle${preferLocal ? ' on' : ''}`}
                  style={{ marginTop: 8 }}
                  title="Check whether the robot answers on the server's own network and connect directly when it does; the cloud relay is only used when it doesn't"
                >
                  <span className="toggle-label">
                    <PlugIcon size={15} />
                    Direct when on the same network
                  </span>
                  <input
                    type="checkbox"
                    checked={preferLocal}
                    disabled={locked}
                    onChange={(e) => {
                      setPreferLocal(e.target.checked)
                      localStorage.setItem(STORE.route, e.target.checked ? 'auto' : 'relay')
                    }}
                    style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }}
                  />
                  <span className="track" />
                </label>
              </div>
            )}

            <div className="btn-row" style={{ marginTop: 8 }}>
              {locked ? (
                <button className="btn danger block" title="Close the link and free the robot for another client" onClick={disconnect}>
                  Disconnect
                </button>
              ) : (
                <>
                  <button className="btn primary" onClick={doConnect} disabled={busy || !canConnect} style={{ flex: 1 }} title="Open the WebRTC link to the robot">
                    {busy ? 'Connecting…' : 'Connect'}
                  </button>
                  {(method === 'ip' || method === 'serial') && (
                    <button className="btn" onClick={doScan} disabled={scanning} title="Search this network for robots">
                      <ScanIcon size={14} />
                      {scanning ? 'Scanning…' : 'Scan'}
                    </button>
                  )}
                </>
              )}
            </div>

            {note && (
              <p className="note warn" role="alert">
                {note}
              </p>
            )}

            {found.map((r) => (
              <button
                key={r.ip}
                className="btn sm block"
                style={{ justifyContent: 'space-between', marginTop: 4 }}
                title="Use this address"
                onClick={() => {
                  setMethod('ip')
                  setIp(r.ip)
                }}
              >
                <span>{r.ip}</span>
                <span style={{ color: 'var(--muted)', fontSize: 11 }}>{r.sn ?? ''}</span>
              </button>
            ))}

            <button className="btn ghost sm block" style={{ marginTop: 6 }} title="Per-device AES key for firmware 1.1.15 and newer" onClick={() => setShowKey((v) => !v)}>
              {showKey ? 'Hide' : 'Device key'}
            </button>

            {showKey && (
              <div className="field" style={{ marginTop: 6 }}>
                <input
                  className="input"
                  value={aesKey}
                  onChange={(e) => setAesKey(e.target.value)}
                  placeholder="32 hex characters"
                  disabled={connected}
                  aria-label="Device AES key"
                />
                <p className="note">
                  Firmware 1.1.15 and newer need this for local connections. Signing in with your account fills it in.
                </p>
              </div>
            )}
          </>
        )}
      </div>

      <div className="section">
        <p className="eyebrow">Motion mode</p>
        <div className="seg">
          {(['normal', 'ai', 'mcf'] as const).map((m) => (
            <button
              key={m}
              className={`seg-btn${motionMode === m ? ' active' : ''}`}
              onClick={() => setMotionMode(m)}
              title={
                m === 'normal' ? 'Walking and gestures'
                  : m === 'ai' ? 'Flips and free gaits'
                    : 'Firmware 1.1.7 and newer'
              }
            >
              {m === 'mcf' ? 'MCF' : m === 'ai' ? 'AI' : 'Normal'}
            </button>
          ))}
        </div>
        <p className="note">Picks which command set the Actions tab offers.</p>

        <div className="btn-row">
          <button className="btn sm" disabled={!connected} title="Ask the robot which mode it is actually in" onClick={() => void refreshMotionMode().catch((e) => log(`Mode read failed: ${(e as Error).message}`))}>
            Read robot
          </button>
          {MOTION_MODE_OPTIONS.map((m) => (
            <button
              key={m.value}
              className="btn sm"
              disabled={!connected}
              title={`Tell the robot to switch to ${m.label} mode. ${m.note}`}
              onClick={() => void switchMotionMode(m.value).catch((e) => log(`Mode switch failed: ${e.message}`))}
            >
              Set {m.label}
            </button>
          ))}
        </div>
        {reportedMode && (
          <p className="note">
            Robot reports <b style={{ color: 'var(--text-strong)' }}>{reportedMode}</b>
          </p>
        )}
      </div>
    </>
  )
}

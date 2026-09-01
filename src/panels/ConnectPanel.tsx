import { useEffect, useState } from 'react'
import { useCloudSession } from '../hooks/useCloudSession'
import { useRemembered } from '../hooks/useRemembered'
import { useRobot } from '../state/RobotContext'
import { SWITCHABLE_MODES } from '../lib/constants'
import type { ConnectMethod, DiscoveredRobot } from '../lib/types'
import { lastServerInfo, probeServer } from '../lib/serverInfo'
import { ScanIcon } from '../components/Icons'

const STORE = {
  method: 'go2.method',
  ip: 'go2.lastIp',
  serial: 'go2.serial',
  key: 'go2.aesKey',
  email: 'go2.email',
  region: 'go2.region',
}

/** What each motion service is called in plain words. */
const SERVICE_LABEL: Record<string, string> = {
  normal: 'Normal',
  ai: 'AI',
  advanced: 'Advanced',
  mcf: 'Unified (1.1.7+)',
}

const SERVICE_NOTE: Record<string, string> = {
  normal: 'Everyday walking, postures and gestures.',
  ai: 'Adds flips, the handstand and the free gaits.',
  advanced: 'Adds cross step, bound and one-sided step.',
}

/**
 * The five ways to reach the robot. The first four all need the robot within
 * radio reach of this machine and differ only in how it is located; Cloud is
 * the one that does not care where either of you is.
 */
const METHODS: { value: ConnectMethod; label: string; blurb: string }[] = [
  { value: 'ip', label: 'IP', blurb: 'You know the robot address. Type it in' },
  { value: 'serial', label: 'Serial', blurb: 'On this network, by serial number' },
  { value: 'ap', label: 'AP', blurb: "Join the robot's own Wi-Fi. No router involved" },
  { value: 'lan', label: 'LAN', blurb: 'Same router as this machine. Found for you' },
  { value: 'cloud', label: 'Cloud', blurb: 'Through your Unitree account, from anywhere' },
]

export default function ConnectPanel() {
  const { connState, connError, link, motion, log } = useRobot()
  const { connect, disconnect, retry } = link
  const { reportedMode, refreshMode: refreshMotionMode, switchMode: switchMotionMode } = motion

  // A cloud deployment has no network of its own, so every method that reaches
  // the robot through the server's LAN is dead there and says so rather than
  // failing with a message about routers.
  const [serverless, setServerless] = useState(() => lastServerInfo()?.serverless ?? false)
  useEffect(() => {
    if (lastServerInfo()) return
    void probeServer().then((i) => setServerless(i.serverless))
  }, [])

  const [rememberedMethod, setMethod] = useRemembered(STORE.method, 'ip')
  // A build that removes a method must not leave the panel stuck on it, and a
  // cloud deployment can only ever use the one.
  const method: ConnectMethod = serverless
    ? 'cloud'
    : METHODS.some((m) => m.value === rememberedMethod)
      ? (rememberedMethod as ConnectMethod)
      : 'ip'

  const [ip, setIp] = useRemembered(STORE.ip, '192.168.12.1')
  const [serial, setSerial] = useRemembered(STORE.serial, '')
  const [aesKey, setAesKey] = useRemembered(STORE.key, '')
  const [showKey, setShowKey] = useState(false)

  const [email, setEmail] = useRemembered(STORE.email, '')
  const [password, setPassword] = useState('')
  const [region, setRegion] = useRemembered(STORE.region, 'global')
  // A sign-in is remembered for a day so reopening the console doesn't ask
  // again; Sign out (or an expired save) drops back to the login form.
  const { token, robots: cloudRobots, signingIn, signIn, signOut } = useCloudSession()
  const [pickedSerial, setPickedSerial] = useState('')


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


  /** Ask the server which robots answer on its own network. */
  const discover = async (): Promise<DiscoveredRobot[]> => {
    const res = await fetch('/api/discover')
    const body = (await res.json()) as { robots?: DiscoveredRobot[]; error?: string }
    if (!res.ok) throw new Error(body.error ?? `Scan failed with HTTP ${res.status}`)
    return body.robots ?? []
  }

  const doConnect = async () => {
    setBusy(true)
    setNote(null)
    try {
      // LAN is the no-typing case: find whatever is on this router, then talk
      // to it by address. The transports below it never see a 'lan' method.
      let targetIp = ip.trim()
      if (method === 'lan') {
        setNote('Looking for the robot on this network…')
        const robots = await discover()
        if (!robots.length) {
          throw new Error('No robot answered on this network. Check both are on the same router, or use IP.')
        }
        targetIp = robots[0].ip
        setIp(targetIp)
        setNote(robots.length > 1 ? `Found ${robots.length} robots, using ${targetIp}.` : null)
      }

      await connect({
        method: method === 'lan' ? 'ip' : method,
        ip: targetIp,
        serial: method === 'cloud' ? pickedSerial : serial.trim(),
        aesKey: aesKey.trim(),
        token,
        region,
      })
    } catch (e) {
      setNote((e as Error).message)
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
      const robots = await discover()
      setFound(robots)
      if (robots.length) log(`Found ${robots.length} robot(s).`)
      else setNote('No robots answered on this network.')
    } catch (e) {
      setNote(`Scan failed: ${(e as Error).message}`)
    } finally {
      setScanning(false)
    }
  }

  const doSignIn = async () => {
    setNote(null)
    try {
      const robots = await signIn(email.trim(), password, region)
      setPassword('')
      if (!robots.length) {
        setNote('Signed in, but no robots are bound to this account.')
        return
      }
      setPickedSerial(robots[0].sn)
      // The account carries the device key, so the operator does not have to.
      if (robots[0].aesKey && !aesKey) setAesKey(robots[0].aesKey)
      log(`Signed in. ${robots.length} robot(s) on this account.`)
    } catch (e) {
      setNote(`Sign in failed: ${(e as Error).message}`)
    }
  }

  const canConnect =
    method === 'ip' ? !!ip.trim()
      : method === 'serial' ? !!serial.trim()
        : method === 'ap' || method === 'lan' ? true
          : !!token && !!pickedSerial

  const methodLabel = METHODS.find((m) => m.value === method)?.label ?? method
  const where = method === 'cloud' ? pickedSerial : method === 'serial' ? serial : ip

  // The form is only useful when you can act on it: hide it while a link is up
  // or being established, keep it visible when idle or after a failure.
  const showForm = open && !connecting


  return (
    <>
      <div className={`section conn conn-${connState}`}>
        <div className="conn-status">
          <div className="conn-text">
            <span className="conn-sub" title={connState === 'error' ? (connError ?? undefined) : undefined}>
              {connState === 'connected' ? `${where} · ${methodLabel}`
                : connState === 'connecting' ? `Reaching ${where || 'the robot'}…`
                  : connState === 'validating' ? 'Exchanging keys'
                    : connState === 'error' ? (connError ?? 'Unknown error')
                      : 'Choose how to reach the robot'}
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
            {serverless ? (
              <>
                <p className="note">
                  This console is deployed in the cloud, so it has no network of its own. Signing in to your Unitree
                  account is the only way to reach the robot from here.
                </p>
                <p className="note">
                  To use IP, Serial, AP or LAN, run the console on a machine at home and open the address it prints.
                  The robot's handshake sends no CORS headers, so the signalling has to happen on its own network.
                </p>
              </>
            ) : (
            <div className="seg" role="tablist" aria-label="Connection method">
              {METHODS.map((m) => (
                <button
                  key={m.value}
                  role="tab"
                  aria-selected={method === m.value}
                  className={`seg-btn${method === m.value ? ' active' : ''}`}
                  disabled={locked || (serverless && m.value !== 'cloud')}
                  title={serverless && m.value !== 'cloud' ? 'This deployment has no network of its own - use Cloud.' : m.blurb}
                  onClick={() => setMethod(m.value)}
                >
                  {m.label}
                </button>
              ))}
            </div>
            )}
            {!serverless && <p className="note">{METHODS.find((m) => m.value === method)?.blurb}</p>}

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

            {/* {method === 'ap' && (
              <p className="note">
                Join the Wi-Fi named after the robot's serial. This machine loses internet
              </p>
            )} */}

            {method === 'lan' && (
              <p className="note">
                Finds the first robot on this router
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
                <button className="btn block primary" onClick={doSignIn} disabled={signingIn || !email || !password}>
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
                  {cloudRobots.map((r) => (
                    <option key={r.sn} value={r.sn}>
                      {r.name ? `${r.name} - ${r.sn}` : r.sn}
                    </option>
                  ))}
                </select>
                <button
                  className="btn sm ghost mt-1"
                  disabled={locked}
                  title="Forget this sign-in on this browser"
                  onClick={() => { signOut(); setPickedSerial('') }}
                >
                  Sign out
                </button>
              </div>
            )}

            <div className="btn-row mt-3">
              {locked ? (
                <button className="btn danger block" title="Close the link and free the robot for another client" onClick={disconnect}>
                  Disconnect
                </button>
              ) : (
                <>
                  <button className="btn primary" onClick={doConnect} disabled={busy || !canConnect} style={{ flex: 1 }} title="Open the WebRTC link to the robot">
                    {busy ? 'Connecting…' : 'Connect'}
                  </button>
                  {!serverless && (method === 'ip' || method === 'serial' || method === 'lan') && (
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
                className="btn sm block mt-1"
                style={{ justifyContent: 'space-between' }}
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

            <button className="btn ghost sm block mt-2" title="Per-device AES key for firmware 1.1.15 and newer" onClick={() => setShowKey((v) => !v)}>
              {showKey ? 'Hide' : 'Device key'}
            </button>

            {showKey && (
              <div className="field mt-2">
                <input
                  className="input"
                  value={aesKey}
                  onChange={(e) => setAesKey(e.target.value)}
                  placeholder="32 hex characters"
                  disabled={connected}
                  aria-label="Device AES key"
                />
                <p className="note">
                  Needed on firmware 1.1.15 and newer. Signing in fills it in.
                </p>
              </div>
            )}
          </>
        )}
      </div>

      <div className="section">
        <p className="eyebrow">Motion service</p>
        {!connected ? (
          <p className="note">Reported once connected</p>
        ) : (
          <>
            <div className="kv mb-3">
              <dt>Running</dt>
              <dd>{reportedMode ? SERVICE_LABEL[reportedMode] ?? reportedMode : 'asking…'}</dd>
            </div>

            {reportedMode && reportedMode !== 'mcf' && (
              <>
                <p className="note">Switching takes a few seconds; the robot stands still</p>
                <div className="btn-row">
                  {SWITCHABLE_MODES.map((m) => (
                    <button
                      key={m}
                      className={`btn sm${reportedMode === m ? ' on' : ''}`}
                      disabled={reportedMode === m}
                      title={SERVICE_NOTE[m]}
                      onClick={() => void switchMotionMode(m).catch((e) => setNote(`Could not switch: ${e.message}`))}
                    >
                      {SERVICE_LABEL[m]}
                    </button>
                  ))}
                </div>
              </>
            )}

            {reportedMode === 'mcf' && (
              <p className="note">
                One service runs everything. Nothing to switch.
              </p>
            )}

            <button
              className="btn sm ghost mt-2"
              title="Ask the robot again which motion service it is running"
              onClick={() => void refreshMotionMode().catch((e) => setNote(`Could not read the motion service: ${(e as Error).message}`))}
            >
              Re-check
            </button>
          </>
        )}
      </div>
    </>
  )
}

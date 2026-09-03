// Getting from "which robot" to "here is an answer".
//
// Signalling on this robot is one-shot over HTTP: an offer goes out through the
// local proxy or the Unitree cloud, an answer comes back, and that is the end of
// it - there is no renegotiating afterwards, which is why a dropped link has to
// be reopened from scratch rather than repaired.
//
// It lives apart from the connection because it is the branchiest part of
// connecting and shares nothing with what follows. Five methods, a same-network
// shortcut that can hit or miss, relay credentials that can fail: all decided
// before a peer connection exists. Keeping it here means it can be exercised
// against a stubbed fetch instead of a robot, a network and a proxy.
//
// Imports nothing at runtime (one type-only import, which node strips), so the
// tests load it straight from source.

import type { DiscoveredRobot } from './types.ts'

/** How the console is asked to reach the robot. */
export interface ConnectOptions {
  /** how to reach the robot; defaults to a direct address */
  method?: 'ip' | 'serial' | 'ap' | 'cloud'
  ip?: string
  /** robot serial number, for serial discovery and cloud relay */
  serial?: string
  /** Unitree cloud access token, required for the cloud method */
  token?: string
  /** per-device AES key (32 hex chars), required on firmware >= 1.1.15 */
  aesKey?: string
  region?: string
  /**
   * How a cloud robot is reached. 'auto' (the default) checks whether the robot
   * answers on the server's own network and connects directly when it does,
   * falling back to the relay when it does not. 'relay' always goes through the
   * cloud.
   */
  route?: 'auto' | 'relay'
}

/** What signalling needs from the world, so a test can supply its own. */
export interface SignallingDeps {
  fetch: typeof globalThis.fetch
  /** False on a serverless deployment, which has no network of its own. */
  serverHasLan: boolean
}

/** The decided way to reach one robot, and what the peer connection needs. */
export interface Route {
  method: 'ip' | 'serial' | 'ap' | 'cloud'
  targetIp: string
  /** The address to show the operator, once one is known. */
  ip: string
  iceServers: RTCIceServer[]
  turnServer: unknown
  /** True when a cloud robot turned out to be reachable on this network. */
  viaShortcut: boolean
  /** Lines worth putting in the traffic log, in order. */
  notes: string[]
}

/** The robot's own address, when connected to its access point. */
const AP_ADDRESS = '192.168.12.1'

/** A slow same-network check must never hold up the real connection. */
const LOCAL_CHECK_MS = 4000

/**
 * Decide how to reach the robot and gather what the peer connection will need
 * before it is built - the ICE configuration has to be in place before the
 * offer, so this runs first.
 *
 * Throws only when the chosen route cannot be prepared at all. The same-network
 * check is an optimisation and never fails the attempt: a server that cannot
 * answer it just means going the long way round.
 */
export async function planRoute(opts: ConnectOptions, deps: SignallingDeps): Promise<Route> {
  const notes: string[] = []
  let method = opts.method ?? 'ip'
  let targetIp = opts.ip ?? ''
  let viaShortcut = false

  // A "cloud" robot sitting on the server's own network does not need the relay
  // at all: signal it locally and the media stays here. Skipped where it cannot
  // work rather than asked and answered no.
  if (method === 'cloud' && opts.serial && deps.serverHasLan && (opts.route ?? 'auto') === 'auto') {
    const found = await localCheck(opts.serial, deps)
    if (found) {
      method = 'ip'
      targetIp = found
      viaShortcut = true
      notes.push(`robot is on this network (${found}) - connecting directly, skipping the relay`)
    }
  }

  let iceServers: RTCIceServer[] = []
  let turnServer: unknown = null

  // A LAN robot is directly reachable, so an empty ICE configuration gathers
  // fast. A cloud robot is behind NAT and has to relay through the same TURN
  // server it uses itself.
  if (method === 'cloud') {
    const relay = await fetchRelay(opts, deps)
    iceServers = relay.iceServers
    turnServer = relay.turnServer
    notes.push(`relay ready (${iceServers.length} ICE server${iceServers.length === 1 ? '' : 's'})`)
  }

  return {
    method,
    targetIp,
    ip: method === 'ap' ? AP_ADDRESS : targetIp || (opts.serial ?? ''),
    iceServers,
    turnServer,
    viaShortcut,
    notes,
  }
}

/** Trade a local offer for the robot's answer along a planned route. */
export async function exchangeOffer(
  sdp: { sdp: string; type: string },
  route: Route,
  opts: ConnectOptions,
  deps: SignallingDeps,
): Promise<{ answer: { sdp: string; type: RTCSdpType }; ip?: string }> {
  const resp = await deps.fetch('/api/connect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      method: route.method,
      ip: route.targetIp,
      serial: opts.serial ?? '',
      token: opts.token ?? '',
      aesKey: opts.aesKey ?? '',
      region: opts.region ?? 'global',
      turnServer: route.turnServer,
      sdp,
    }),
  })

  if (!resp.ok) {
    const body = (await resp.json().catch(() => ({}))) as { error?: string }
    // The proxy explains what the robot said - already busy, mid-transition, a
    // wrong device key. That reading is worth far more than the status code.
    throw new Error(body.error ?? `Signaling failed with HTTP ${resp.status}`)
  }

  const answer = (await resp.json()) as { sdp: string; type: RTCSdpType; ip?: string }
  return { answer, ip: answer.ip }
}

/** Ask the server whether this serial answers on its own network. */
async function localCheck(serial: string, deps: SignallingDeps): Promise<string | null> {
  try {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), LOCAL_CHECK_MS)
    try {
      const res = await deps.fetch('/api/cloud/local-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serial }),
        signal: ctl.signal,
      })
      const found = (await res.json()) as { ip?: string | null }
      return found.ip ?? null
    } finally {
      clearTimeout(timer)
    }
  } catch {
    // No answer, a timeout, or no server at all. The relay still works.
    return null
  }
}

/** Relay credentials for a cloud robot. Failing here fails the attempt. */
async function fetchRelay(opts: ConnectOptions, deps: SignallingDeps) {
  const resp = await deps.fetch('/api/cloud/turn', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ serial: opts.serial ?? '', token: opts.token ?? '', region: opts.region ?? 'global' }),
  })
  if (!resp.ok) {
    const body = (await resp.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? 'Could not get relay credentials from the cloud')
  }
  const body = (await resp.json()) as { turnServer: unknown; iceServers: RTCIceServer[] }
  return { turnServer: body.turnServer, iceServers: body.iceServers ?? [] }
}

/** What the connect form has filled in, whether or not it is enough. */
export interface ConnectFields {
  ip: string
  serial: string
  token: string
  /** the robot chosen from the signed-in account's list */
  pickedSerial: string
}

/**
 * Whether Connect can be pressed. Each method needs one thing: an address, a
 * serial, nothing at all (the access point is a fixed address, and lan finds
 * its own), or a signed-in account with a robot picked from it.
 */
export function canConnect(method: string, f: ConnectFields): boolean {
  if (method === 'ip') return !!f.ip.trim()
  if (method === 'serial') return !!f.serial.trim()
  if (method === 'ap' || method === 'lan') return true
  if (method === 'cloud') return !!f.token && !!f.pickedSerial
  return false
}

/** Ask the server which robots answer on its own network. */
export async function scanForRobots(deps: SignallingDeps): Promise<DiscoveredRobot[]> {
  const res = await deps.fetch('/api/discover')
  const body = (await res.json()) as { robots?: DiscoveredRobot[]; error?: string }
  if (!res.ok) throw new Error(body.error ?? `Scan failed with HTTP ${res.status}`)
  return body.robots ?? []
}

/**
 * What the lan method means: find whatever is on this router and talk to it by
 * address. The transports never see a 'lan' method - it resolves to a plain ip
 * here, before a connection is opened. Throws when nothing answers, with what
 * to try next; more than one robot names the choice it made.
 */
export async function resolveLanTarget(deps: SignallingDeps): Promise<{ ip: string; note: string | null }> {
  const robots = await scanForRobots(deps)
  if (!robots.length) {
    throw new Error('No robot answered on this network. Check both are on the same router, or use IP.')
  }
  return { ip: robots[0].ip, note: robots.length > 1 ? `Found ${robots.length} robots, using ${robots[0].ip}.` : null }
}

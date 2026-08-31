// LAN robot discovery.
// Unitree robots answer a multicast probe on 239.255.255.250:10134 with a JSON
// blob containing their serial number. Firmware that does not answer is still
// found by the ARP-free fallback: probing the signaling ports on the local /24.

import dgram from 'node:dgram'
import net from 'node:net'
import os from 'node:os'

const MULTICAST_ADDR = '239.255.255.250'
const MULTICAST_PORT = 10134
const PROBE = Buffer.from(JSON.stringify({ name: 'unitree', type: 'query' }))

function parseAnnouncement(text) {
  try {
    const obj = JSON.parse(text)
    const sn = obj.sn ?? obj.serial ?? obj.SN ?? obj.serialNumber
    const ip = obj.ip ?? obj.IP ?? obj.address
    if (ip) return { ip, sn, name: obj.name }
  } catch {
    // Some firmware replies with "sn,ip" or a bare serial number.
    const parts = String(text).trim().split(/[,;\s]+/)
    const ip = parts.find((p) => /^\d+\.\d+\.\d+\.\d+$/.test(p))
    if (ip) return { ip, sn: parts.find((p) => p !== ip) }
  }
  return null
}

function multicastScan(timeoutMs) {
  return new Promise((resolve) => {
    const found = new Map()
    let socket
    try {
      socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })
    } catch {
      resolve([])
      return
    }

    const finish = () => {
      try {
        socket.close()
      } catch {
        /* already closed */
      }
      resolve([...found.values()])
    }

    socket.on('error', finish)
    socket.on('message', (msg, rinfo) => {
      const parsed = parseAnnouncement(msg.toString('utf8')) ?? { ip: rinfo.address }
      found.set(parsed.ip, { ...parsed, ip: parsed.ip || rinfo.address })
    })
    socket.on('listening', () => {
      try {
        socket.setBroadcast(true)
        socket.addMembership(MULTICAST_ADDR)
      } catch {
        /* interface may not support multicast */
      }
      socket.send(PROBE, MULTICAST_PORT, MULTICAST_ADDR)
      socket.send(PROBE, MULTICAST_PORT, '255.255.255.255')
    })

    socket.bind(0)
    setTimeout(finish, timeoutMs)
  })
}

export function probePort(ip, port, timeoutMs) {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    const done = (ok) => {
      socket.destroy()
      resolve(ok)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
    socket.connect(port, ip)
  })
}

/**
 * An address as a number, and back. Every step is forced unsigned: without the
 * >>> a shift past bit 31 goes negative, which turns a netmask into a negative
 * number and the whole sweep into nonsense.
 */
export const toInt = (ip) => ip.split('.').reduce((n, o) => (n << 8 >>> 0) + Number(o), 0) >>> 0
export const toIp = (n) => [24, 16, 8, 0].map((s) => (n >>> s) & 255).join('.')

/**
 * Widest sweep we will attempt. A /24 is 254 hosts; some home routers hand out
 * a /19, which is 8190. Beyond this the sweep costs more than it is worth and
 * the address is better typed in.
 */
export const MAX_SWEEP_HOSTS = 8192

/**
 * Addresses worth probing, in the order worth probing them: this machine's own
 * /24 first because that is where the robot almost always is, then the rest of
 * the real subnet if the interface is wider than a /24, then the robot's own AP.
 *
 * The netmask matters. Assuming a /24 is what made discovery come up empty on a
 * /19 network - the robot was three octets away and simply never scanned.
 */
export function candidateAddresses(interfaces = os.networkInterfaces()) {
  const near = []
  const far = []
  for (const addrs of Object.values(interfaces)) {
    for (const a of addrs ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue
      const self = toInt(a.address)
      const mask = toInt(a.netmask ?? '255.255.255.0')
      const network = (self & mask) >>> 0
      const size = (~mask >>> 0) + 1

      const ownPrefix = a.address.split('.').slice(0, 3).join('.')
      for (let h = 1; h < 255; h++) near.push(`${ownPrefix}.${h}`)

      if (size > 256 && size <= MAX_SWEEP_HOSTS) {
        for (let i = 1; i < size - 1; i++) {
          const ip = toIp((network + i) >>> 0)
          if (!ip.startsWith(`${ownPrefix}.`)) far.push(ip)
        }
      }
    }
  }
  for (let h = 1; h < 255; h++) far.push(`192.168.12.${h}`) // robot AP mode
  return [...new Set([...near, ...far])]
}

/** Sweep the reachable address space for hosts with a Go2 signaling port open. */
async function portScan(timeoutMs) {
  const found = []
  const deadline = Date.now() + timeoutMs
  const targets = candidateAddresses()

  // A wide subnet is only searchable in the time available with a lot of
  // sockets in flight; the probes are short-lived and mostly time out.
  const CONCURRENCY = 256
  let cursor = 0
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (cursor < targets.length && Date.now() < deadline) {
      const ip = targets[cursor++]
      if (await probePort(ip, 9991, 400)) found.push({ ip, port: 9991 })
      else if (await probePort(ip, 8081, 400)) found.push({ ip, port: 8081 })
    }
  })
  await Promise.all(workers)
  return found
}

/** serial -> { ip, at }. A robot keeps its DHCP lease for far longer than
 * this, so repeat connects skip the multicast wait; a miss is never cached,
 * so an offline robot is re-probed every time. */
const serialCache = new Map()
const SERIAL_CACHE_MS = 5 * 60 * 1000

/** Find the address of a robot by its serial number, or null if it does not answer. */
export async function resolveSerial(serial, timeoutMs = 4000) {
  const wanted = String(serial).trim().toLowerCase()
  const hitCached = serialCache.get(wanted)
  if (hitCached && Date.now() - hitCached.at < SERIAL_CACHE_MS) return hitCached.ip
  const robots = await discoverRobots(timeoutMs)
  const hit = robots.find((r) => String(r.sn ?? '').trim().toLowerCase() === wanted)
  if (hit?.ip) serialCache.set(wanted, { ip: hit.ip, at: Date.now() })
  return hit?.ip ?? null
}

/**
 * Find robots on the LAN. Multicast first (fast, gives serial numbers); if that
 * turns up nothing, fall back to sweeping the signaling ports.
 */
export async function discoverRobots(timeoutMs = 3000) {
  const announced = await multicastScan(Math.min(timeoutMs, 2000))
  const verified = []
  for (const robot of announced) {
    if (await probePort(robot.ip, 9991, 600) || await probePort(robot.ip, 8081, 600)) {
      verified.push(robot)
    }
  }
  if (verified.length) return verified

  const scanned = await portScan(timeoutMs)
  return scanned.map((r) => ({ ip: r.ip, sn: undefined, name: `Signaling port ${r.port}` }))
}

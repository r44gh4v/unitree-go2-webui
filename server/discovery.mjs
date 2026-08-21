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

/** Candidate subnets: every non-internal IPv4 interface, plus the robot's own AP. */
function localSubnets() {
  const nets = []
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal) {
        nets.push(a.address.split('.').slice(0, 3).join('.'))
      }
    }
  }
  if (!nets.includes('192.168.12')) nets.push('192.168.12') // robot AP mode
  return [...new Set(nets)]
}

/** Sweep the local /24s for hosts with a Go2 signaling port open. */
async function portScan(timeoutMs) {
  const found = []
  const deadline = Date.now() + timeoutMs
  const targets = []
  for (const subnet of localSubnets()) {
    for (let host = 1; host < 255; host++) targets.push(`${subnet}.${host}`)
  }

  const CONCURRENCY = 64
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

/** Find the address of a robot by its serial number, or null if it does not answer. */
export async function resolveSerial(serial, timeoutMs = 4000) {
  const wanted = String(serial).trim().toLowerCase()
  const robots = await discoverRobots(timeoutMs)
  const hit = robots.find((r) => String(r.sn ?? '').trim().toLowerCase() === wanted)
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

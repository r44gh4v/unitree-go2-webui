// Which addresses are worth probing when looking for a robot on this network.
//
// This has already been wrong once in a way nobody could see: assuming every
// network is a /24 made discovery come up empty on a /19, where the robot sat
// three octets away and was simply never scanned. The fix was netmask
// arithmetic done with bit shifts, which is its own opportunity to be quietly
// wrong - a sign bit in the wrong place turns a netmask into a negative number
// and the whole sweep into nonsense.
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const modPath = path.join(here, '..', 'server', 'discovery.mjs')
const { toInt, toIp, candidateAddresses, MAX_SWEEP_HOSTS } = await import(
  'file://' + modPath.replace(/\\/g, '/')
)

import { makeChecker } from './harness.mjs'
const { check, finish } = makeChecker()

/** One interface, shaped the way os.networkInterfaces() reports them. */
const iface = (address, netmask) => ({ family: 'IPv4', internal: false, address, netmask })

console.log('[discovery] addresses to numbers and back')
{
  check('a private address', toInt('192.168.0.1'), 3232235521)
  check('zero', toInt('0.0.0.0'), 0)
  // The top bit set is where a shift without >>> turns the value negative.
  check('the broadcast address stays positive', toInt('255.255.255.255') > 0, true)
  check('and is the full 32-bit value', toInt('255.255.255.255'), 4294967295)
  check('a netmask with the top bit set', toInt('255.255.255.0'), 4294967040)
  check('a class A address', toInt('10.0.0.1'), 167772161)
}
{
  for (const ip of ['0.0.0.0', '10.0.0.1', '192.168.12.1', '172.16.255.254', '255.255.255.255']) {
    check(`${ip} survives a round trip`, toIp(toInt(ip)), ip)
  }
}

console.log('[discovery] a /24, the ordinary case')
{
  const out = candidateAddresses({ wifi: [iface('192.168.0.153', '255.255.255.0')] })
  check('sweeps the whole usable range', out.includes('192.168.0.1') && out.includes('192.168.0.254'), true)
  check('skips the network address', out.includes('192.168.0.0'), false)
  check('skips the broadcast address', out.includes('192.168.0.255'), false)
  check('own subnet comes before the access point range', out.indexOf('192.168.0.1') < out.indexOf('192.168.12.1'), true)
}

console.log('[discovery] a wider network')
{
  // The case that was broken: on a /19 the robot can be three octets away.
  const out = candidateAddresses({ wifi: [iface('192.168.0.153', '255.255.224.0')] })
  check('still sweeps our own /24 first', out.indexOf('192.168.0.1') < out.indexOf('192.168.5.1'), true)
  check('and reaches the rest of the real subnet', out.includes('192.168.5.1'), true)
  check('within the subnet, not beyond it', out.includes('192.168.31.254'), true)
  check('and not outside it', out.includes('192.168.32.1'), false)
}
{
  // Wider than we are willing to sweep: a /16 is 65534 hosts, and probing them
  // all costs more than it is worth. Our own /24 is still covered.
  const out = candidateAddresses({ wifi: [iface('10.0.5.7', '255.255.0.0')] })
  check('a network too wide is not swept whole', out.length < MAX_SWEEP_HOSTS, true)
  check('but our own /24 still is', out.includes('10.0.5.200'), true)
}

console.log('[discovery] interfaces that are not worth scanning')
{
  const out = candidateAddresses({
    lo: [{ family: 'IPv4', internal: true, address: '127.0.0.1', netmask: '255.0.0.0' }],
    eth: [{ family: 'IPv6', internal: false, address: 'fe80::1', netmask: 'ffff::' }],
  })
  check('loopback is skipped', out.some((a) => a.startsWith('127.')), false)
  check('IPv6 is skipped', out.some((a) => a.includes(':')), false)
  // The robot's own hotspot is always worth a look, whatever this machine is on.
  check('the access point range is always included', out.includes('192.168.12.1'), true)
}
{
  const out = candidateAddresses({})
  check('no interfaces still tries the access point', out.includes('192.168.12.100'), true)
}

console.log('[discovery] no address is probed twice')
{
  // Two interfaces on one subnet, which a machine on wifi and ethernet has.
  const out = candidateAddresses({
    wifi: [iface('192.168.0.153', '255.255.255.0')],
    eth: [iface('192.168.0.20', '255.255.255.0')],
  })
  check('duplicates are removed', out.length, new Set(out).size)
}
{
  // A machine already on the robot's hotspot must not queue that range twice.
  const out = candidateAddresses({ wifi: [iface('192.168.12.50', '255.255.255.0')] })
  check('the access point range is not doubled', out.length, new Set(out).size)
}

finish()

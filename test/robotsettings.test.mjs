// The robot-wide settings the System panel offers: which exist per motion
// service, and the exact shapes their values take on the wire. The codecs are
// wire truth - remote permission is not a boolean on the wire - so they are
// pinned here rather than living untested inside a panel.
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const modPath = path.join(here, '..', 'src', 'lib', 'robotSettings.ts')
const { ROBOT_SETTINGS, settingsFor } = await import('file://' + modPath.replace(/\\/g, '/'))

import { makeChecker } from './harness.mjs'
const { check, finish } = makeChecker()

const byKey = Object.fromEntries(ROBOT_SETTINGS.map((s) => [s.key, s]))

console.log('[robotsettings] remote permission is 2-allows / 1-forbids, not a boolean')
{
  const s = byKey.remotePermission
  check('on encodes as 2', s.encode(true), { enable_status: 2 })
  check('off encodes as 1', s.encode(false), { enable_status: 1 })
  check('2 decodes to on', s.decode({ enable_status: 2 }), true)
  check('1 decodes to off', s.decode({ enable_status: 1 }), false)
  check('a missing field stays unknown', s.decode({}), undefined)
  check('a non-number stays unknown', s.decode({ enable_status: 'yes' }), undefined)
}

console.log('[robotsettings] the boolean-shaped settings')
{
  check('voice on', byKey.voice.encode(true), { enable: 1 })
  check('voice off', byKey.voice.encode(false), { enable: 0 })
  check('voice reads back from enable', byKey.voice.decode({ enable: 1 }), true)
  check('silent start is a real boolean', byKey.silent.encode(true), { silent: true })
  check('silent reads back', byKey.silent.decode({ silent: false }), false)
  check('auto recovery wraps in data', byKey.autoRecovery.encode(true), { data: true })
  check('auto recovery reads a wrapped answer', byKey.autoRecovery.decode({ data: true }), true)
  check('auto recovery reads a bare answer', byKey.autoRecovery.decode(1), true)
  check('uwb on', byKey.uwb.encode(true), { enable: 1 })
}

console.log('[robotsettings] a setting with no getter stays unknown rather than guessed')
{
  check('joystick offers no decode', byKey.joystick.decode, undefined)
  check('uwb offers no decode', byKey.uwb.decode, undefined)
}

console.log('[robotsettings] which settings exist per motion service')
{
  check('auto recovery is unified-firmware only', settingsFor('normal').some((s) => s.key === 'autoRecovery'), false)
  check('mcf sees auto recovery', settingsFor('mcf').some((s) => s.key === 'autoRecovery'), true)
  check('everything else is service-independent', settingsFor('normal').length, ROBOT_SETTINGS.length - 1)
}

finish()

// Robot-wide settings the phone app also carries, and that this link can
// genuinely reach. Anything the app does over Bluetooth rather than over the
// data channel - the Wi-Fi name and password above all - is not here, because
// no api exists for it.
//
// This is wire truth, not interface state: which topic and api id each setting
// answers on, and the exact shape its value takes - remote permission is not a
// boolean on the wire (2 allows, 1 forbids). Those facts lived inside the
// System panel, where a transcription slip could not be caught by a test.
// The panel now asks for the list and the codecs; the shapes stay here.
//
// Imports only constants.ts, with the extension, so node loads it straight
// from source for the tests - see CLAUDE.md's testing constraints.

import { MOTION_SWITCHER_API, RM_CON_API, SPORT_CMD, SPORT_CMD_MCF, TOPICS, UWB_API, VUI_API } from './constants.ts'

export interface RobotSetting {
  key: string
  label: string
  note: string
  topic: string
  setId: number
  getId?: number
  /** builds the write payload from the toggle's next position */
  encode: (on: boolean) => unknown
  /** pulls the boolean out of whatever shape the getter answers with;
   *  absent when the robot offers no getter - unknown, never guessed */
  decode?: (v: unknown) => boolean | undefined
  /** only exists on the unified (mcf) service */
  mcfOnly?: boolean
}

const asBool = (v: unknown): boolean | undefined => {
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  return undefined
}

export const ROBOT_SETTINGS: RobotSetting[] = [
  {
    key: 'autoRecovery',
    label: 'Get up automatically after a fall',
    note: 'The robot rights itself without being asked. Unified firmware only.',
    topic: TOPICS.SPORT_MOD,
    setId: SPORT_CMD_MCF.SetAutoRecovery,
    getId: SPORT_CMD_MCF.GetAutoRecovery,
    encode: (on) => ({ data: on }),
    decode: (v) => asBool((v as { data?: unknown })?.data ?? v),
    mcfOnly: true,
  },
  {
    key: 'joystick',
    label: 'Handheld remote enabled',
    note: 'Turns the physical controller on or off. Reported unreliable on some firmware.',
    topic: TOPICS.SPORT_MOD,
    setId: SPORT_CMD.SwitchJoystick,
    encode: (on) => ({ data: on }),
  },
  {
    key: 'voice',
    label: 'Voice assistant',
    note: 'Master switch for the voice UI. Turning it off also silences spoken feedback.',
    topic: TOPICS.VUI,
    setId: VUI_API.SET_SWITCH,
    getId: VUI_API.GET_SWITCH,
    encode: (on) => ({ enable: on ? 1 : 0 }),
    decode: (v) => asBool((v as { enable?: unknown })?.enable),
  },
  {
    key: 'remotePermission',
    label: 'Allow connections over the internet',
    note: 'Whether the robot accepts cloud-relayed connections at all',
    topic: TOPICS.RM_CON,
    setId: RM_CON_API.SET_PERMISSION,
    getId: RM_CON_API.GET_PERMISSION,
    // Not a boolean on the wire: 2 allows, 1 forbids.
    encode: (on) => ({ enable_status: on ? 2 : 1 }),
    decode: (v) => {
      const n = (v as { enable_status?: unknown })?.enable_status
      return typeof n === 'number' ? n === 2 : undefined
    },
  },
  {
    key: 'silent',
    label: 'Silent start',
    note: 'Do not start the motion service automatically at boot',
    topic: TOPICS.MOTION_SWITCHER,
    setId: MOTION_SWITCHER_API.SET_SILENT,
    getId: MOTION_SWITCHER_API.GET_SILENT,
    encode: (on) => ({ silent: on }),
    decode: (v) => asBool((v as { silent?: unknown })?.silent),
  },
  {
    key: 'uwb',
    label: 'UWB tag following',
    note: 'Only does anything when the ultra-wideband tag accessory is fitted.',
    topic: TOPICS.UWB_REQ,
    setId: UWB_API.SWITCH,
    encode: (on) => ({ enable: on ? 1 : 0 }),
  },
]

/** The settings that exist on the motion service the robot is running. */
export function settingsFor(motionMode: string): RobotSetting[] {
  return ROBOT_SETTINGS.filter((s) => !s.mcfOnly || motionMode === 'mcf')
}

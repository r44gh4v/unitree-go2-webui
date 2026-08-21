// Every documented API id, in one searchable list. The console renders this so
// commands without a dedicated button are still one click away.

import {
  AUDIO_API,
  BASHRUNNER_API,
  GAS_SENSOR_API,
  MOTION_SWITCHER_API,
  OBSTACLES_AVOID_API,
  ROBOT_STATE_API,
  SPORT_CMD,
  SPORT_CMD_MCF,
  TOPICS,
  UWB_API,
  VIDEO_API,
  VUI_API,
} from './constants'

export interface ApiEntry {
  group: string
  /** short label for the result row */
  tag: string
  name: string
  topic: string
  apiId: number
  /** example parameter, pre-filled into the editor */
  parameter?: unknown
  note?: string
}

const sportNotes: Record<string, string> = {
  Damp: 'Motors go compliant; the robot settles to the ground.',
  BalanceStand: 'Ready stance. Required before walking.',
  StopMove: 'Halts locomotion and leaves Pose mode.',
  StandUp: 'Stands with joints locked.',
  StandDown: 'Lies down.',
  RecoveryStand: 'Rights the robot after a fall.',
  Euler: 'Body attitude in radians: roll and pitch within 0.75, yaw within 0.6.',
  Move: 'Velocity command. Send repeatedly to keep moving. Forward is capped near 3.8 m/s, sideways at 1.0.',
  BodyHeight: 'Offset from the default 0.33 m stance, between -0.18 and 0.03.',
  FootRaiseHeight: 'Offset from the default 0.09 m step, between -0.06 and 0.03.',
  SpeedLevel: 'Minus one is slow, zero normal, one fast.',
  SwitchGait: 'Gait by index: 0 idle, 1 trot, 2 running trot, 3 up stairs, 4 down stairs.',
  Trigger: 'Takes no parameter.',
  TrajectoryFollow: 'Takes a top-level array of exactly 30 points; any other count is rejected.',
  ContinuousGait: 'Keeps stepping in place when idle.',
  GetState: 'Reads the named state fields.',
  SwitchJoystick: 'Enables or disables the handheld remote. Reported unreliable on some firmware.',
}

const sportParams: Record<string, unknown> = {
  Move: { x: 0.3, y: 0, z: 0 },
  Euler: { x: 0, y: 0, z: 0 },
  BodyHeight: { data: 0 },
  FootRaiseHeight: { data: 0 },
  SpeedLevel: { data: 0 },
  SwitchGait: { data: 1 },
  Trigger: {},
  ContinuousGait: { data: true },
  SwitchJoystick: { data: true },
  GetState: ['state', 'bodyHeight', 'speedLevel', 'gait', 'continuousGait', 'economicGait'],
  BackFlip: { data: true },
  LeftFlip: { data: true },
  RightFlip: { data: true },
  Handstand: { data: true },
  StandOut: { data: true },
  FreeWalk: { data: true },
  FreeBound: { data: true },
  FreeJump: { data: true },
  FreeAvoid: { data: true },
  ClassicWalk: { data: true },
  CrossStep: { data: true },
  MoonWalk: { data: true },
  OnesidedStep: { data: true },
  Bound: { data: true },
  LeadFollow: { data: true },
  BackStand: { data: true },
  SetAutoRecovery: { data: true },
  SwitchAvoidMode: { data: true },
}

function sportEntries(table: Record<string, number>, group: string, tag: string): ApiEntry[] {
  return Object.entries(table).map(([name, apiId]) => ({
    group,
    tag,
    name,
    topic: TOPICS.SPORT_MOD,
    apiId,
    parameter: sportParams[name],
    note: sportNotes[name],
  }))
}

export const API_CATALOG: ApiEntry[] = [
  ...sportEntries(SPORT_CMD, 'Sport (normal / AI)', 'sport'),
  ...sportEntries(SPORT_CMD_MCF, 'Sport (MCF)', 'mcf'),

  { group: 'Motion switcher', tag: 'mode', name: 'GetMode', topic: TOPICS.MOTION_SWITCHER, apiId: MOTION_SWITCHER_API.GET_MODE, note: 'Reads the active motion mode.' },
  { group: 'Motion switcher', tag: 'mode', name: 'SetMode', topic: TOPICS.MOTION_SWITCHER, apiId: MOTION_SWITCHER_API.SET_MODE, parameter: { name: 'normal' }, note: 'Switches mode; takes several seconds.' },
  { group: 'Motion switcher', tag: 'mode', name: 'ReleaseMode', topic: TOPICS.MOTION_SWITCHER, apiId: MOTION_SWITCHER_API.RELEASE_MODE, note: 'Releases the current mode.' },

  { group: 'Lights and sound', tag: 'vui', name: 'SetVolume', topic: TOPICS.VUI, apiId: VUI_API.SET_VOLUME, parameter: { volume: 5 } },
  { group: 'Lights and sound', tag: 'vui', name: 'GetVolume', topic: TOPICS.VUI, apiId: VUI_API.GET_VOLUME },
  { group: 'Lights and sound', tag: 'vui', name: 'SetBrightness', topic: TOPICS.VUI, apiId: VUI_API.SET_BRIGHTNESS, parameter: { brightness: 5 } },
  { group: 'Lights and sound', tag: 'vui', name: 'GetBrightness', topic: TOPICS.VUI, apiId: VUI_API.GET_BRIGHTNESS },
  { group: 'Lights and sound', tag: 'vui', name: 'SetColor', topic: TOPICS.VUI, apiId: VUI_API.SET_COLOR, parameter: { color: 'cyan', time: 5, flash_cycle: 1000 }, note: 'flash_cycle is optional and must exceed 499 ms.' },

  ...Object.entries(AUDIO_API).map(([name, apiId]) => ({
    group: 'Audio hub',
    tag: 'audio',
    name,
    topic: TOPICS.AUDIO_HUB_REQ,
    apiId,
    parameter: name === 'SELECT_START_PLAY' || name === 'SELECT_DELETE'
      ? { unique_id: '' }
      : name === 'SET_PLAY_MODE'
        ? { play_mode: 'no_cycle' }
        : name === 'SELECT_RENAME'
          ? { unique_id: '', new_name: '' }
          : {},
    note: name.startsWith('UPLOAD') ? 'Expects chunked base64; use the Lights tab instead.' : undefined,
  })),

  { group: 'Obstacle avoidance', tag: 'avoid', name: 'SwitchSet', topic: TOPICS.OBSTACLES_AVOID, apiId: OBSTACLES_AVOID_API.SWITCH_SET, parameter: { enable: true } },
  { group: 'Obstacle avoidance', tag: 'avoid', name: 'SwitchGet', topic: TOPICS.OBSTACLES_AVOID, apiId: OBSTACLES_AVOID_API.SWITCH_GET },
  { group: 'Obstacle avoidance', tag: 'avoid', name: 'Move', topic: TOPICS.OBSTACLES_AVOID, apiId: OBSTACLES_AVOID_API.MOVE, parameter: { x: 0.3, y: 0, yaw: 0, mode: 0 }, note: 'Filtered movement that stops before obstacles.' },
  { group: 'Obstacle avoidance', tag: 'avoid', name: 'UseApiCommands', topic: TOPICS.OBSTACLES_AVOID, apiId: OBSTACLES_AVOID_API.USE_REMOTE_COMMAND_FROM_API, parameter: { is_remote_commands_from_api: true } },

  { group: 'Camera', tag: 'photo', name: 'GetImageSample', topic: TOPICS.FRONT_PHOTO_REQ, apiId: VIDEO_API.GET_IMAGE_SAMPLE, note: 'Returns a 720p JPEG over the binary channel. The Take photo button does this for you.' },

  { group: 'Robot state', tag: 'state', name: 'ServiceSwitch', topic: TOPICS.ROBOT_STATE, apiId: ROBOT_STATE_API.SERVICE_SWITCH, parameter: { name: 'obstacles_avoid', switch: 1 }, note: 'Starts or stops an onboard service.' },
  { group: 'Robot state', tag: 'state', name: 'SetReportFreq', topic: TOPICS.ROBOT_STATE, apiId: ROBOT_STATE_API.SET_REPORT_FREQ, parameter: { interval: 2, duration: 60 }, note: 'Makes the robot publish its service list for a while.' },

  { group: 'Scripts', tag: 'bash', name: 'RunScript', topic: TOPICS.BASH_REQ, apiId: BASHRUNNER_API.RUN_SCRIPT, parameter: { script: 'get_ip_address.sh' }, note: 'Only scripts the robot already ships will run. Arguments go in the same string.' },

  { group: 'UWB', tag: 'uwb', name: 'Switch', topic: TOPICS.UWB_REQ, apiId: UWB_API.SWITCH, parameter: { enable: 1 }, note: 'Turns tag following on or off. Reported by one community source only.' },

  { group: 'Gas sensor', tag: 'gas', name: 'GetState', topic: TOPICS.GAS_SENSOR_REQ, apiId: GAS_SENSOR_API.GET_STATE, note: 'Only present when the sensor accessory is fitted.' },
]

/** SLAM is driven by plain strings, not api ids, so it is listed separately. */
export const SLAM_NOTE =
  'Mapping and navigation use plain text commands on rt/uslam/client_command. Use the Map tab.'

export const API_GROUPS = [...new Set(API_CATALOG.map((e) => e.group))]

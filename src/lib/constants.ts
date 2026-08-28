// Go2 WebRTC topics, API ids, and error tables.
// Transcribed from legion1581/unitree_webrtc_connect constants.py and the
// matching example scripts. Values are wire-exact - changing one silently
// breaks the command it belongs to.

export const DATA_CHANNEL_TYPE = {
  VALIDATION: 'validation',
  SUBSCRIBE: 'subscribe',
  UNSUBSCRIBE: 'unsubscribe',
  MSG: 'msg',
  REQUEST: 'req',
  RESPONSE: 'res',
  VID: 'vid',
  AUD: 'aud',
  ERR: 'err',
  HEARTBEAT: 'heartbeat',
  RTC_INNER_REQ: 'rtc_inner_req',
  RTC_REPORT: 'rtc_report',
  ADD_ERROR: 'add_error',
  RM_ERROR: 'rm_error',
  ERRORS: 'errors',
} as const

export const TOPICS = {
  LOW_STATE: 'rt/lf/lowstate',
  MULTIPLE_STATE: 'rt/multiplestate',
  FRONT_PHOTO_REQ: 'rt/api/videohub/request',
  ULIDAR_SWITCH: 'rt/utlidar/switch',
  ULIDAR: 'rt/utlidar/voxel_map',
  ULIDAR_ARRAY: 'rt/utlidar/voxel_map_compressed',
  ULIDAR_STATE: 'rt/utlidar/lidar_state',
  ROBOTODOM: 'rt/utlidar/robot_pose',
  UWB_REQ: 'rt/api/uwbswitch/request',
  UWB_STATE: 'rt/uwbstate',
  LOW_CMD: 'rt/lowcmd',
  WIRELESS_CONTROLLER: 'rt/wirelesscontroller',
  SPORT_MOD: 'rt/api/sport/request',
  SPORT_MOD_STATE: 'rt/sportmodestate',
  LF_SPORT_MOD_STATE: 'rt/lf/sportmodestate',
  BASH_REQ: 'rt/api/bashrunner/request',
  SELF_TEST: 'rt/selftest',
  GRID_MAP: 'rt/mapping/grid_map',
  SERVICE_STATE: 'rt/servicestate',
  GPT_FEEDBACK: 'rt/gptflowfeedback',
  VUI: 'rt/api/vui/request',
  OBSTACLES_AVOID: 'rt/api/obstacles_avoid/request',
  SLAM_QT_COMMAND: 'rt/qt_command',
  SLAM_ODOMETRY: 'rt/lio_sam_ros2/mapping/odometry',
  AUDIO_HUB_REQ: 'rt/api/audiohub/request',
  AUDIO_HUB_PLAY_STATE: 'rt/audiohub/player/state',
  GAS_SENSOR: 'rt/gas_sensor',
  MOTION_SWITCHER: 'rt/api/motion_switcher/request',
  RM_CON: 'rt/api/rm_con/request',
  ROBOT_STATE: 'rt/api/robot_state/request',
  GAS_SENSOR_REQ: 'rt/api/gas_sensor/request',
  USLAM_CMD: 'rt/uslam/client_command',
  USLAM_SERVER_LOG: 'rt/uslam/server_log',
  USLAM_CLOUD_WORLD: 'rt/uslam/frontend/cloud_world_ds',
  USLAM_ODOM: 'rt/uslam/frontend/odom',
  USLAM_CLOUD_MAP: 'rt/uslam/cloud_map',
  USLAM_LOC_ODOM: 'rt/uslam/localization/odom',
  USLAM_LOC_CLOUD: 'rt/uslam/localization/cloud_world',
  USLAM_NAV_PATH: 'rt/uslam/navigation/global_path',
} as const

// ---- videohub (still photos) ----

export const VIDEO_API = { GET_IMAGE_SAMPLE: 1001 } as const

// ---- robot state service ----

export const ROBOT_STATE_API = {
  /** {name, switch: 0|1} - start or stop an onboard service */
  SERVICE_SWITCH: 1001,
  /** {interval, duration} in seconds - makes the robot publish rt/servicestate */
  SET_REPORT_FREQ: 1002,
} as const

/** Services the robot runs, as named by the service switch API. */
// ---- bashrunner ----

export const BASHRUNNER_API = { RUN_SCRIPT: 1001 } as const

/**
 * The runner only accepts scripts that exist in its own directory - this is a
 * fixed menu, not a shell. Arguments go in the same string, space separated.
 */
export const BASH_SCRIPTS: { script: string; label: string; note?: string; risky?: boolean }[] = [
  { script: 'get_whole_packet_version.sh', label: 'Firmware version' },
  { script: 'get_software_version.sh', label: 'Software version' },
  { script: 'get_hardware_version.sh', label: 'Hardware version', note: 'Returned as tenths, so 10 means 1.0.' },
  { script: 'get_ip_address.sh', label: 'IP addresses', note: 'Reports wlan0 and wlan1' },
  { script: 'get_sn.sh', label: 'Serial number' },
  { script: 'get_rfpower.sh', label: 'Radio power state', note: 'Returns 1 for on, 0 for off' },
  { script: 'get_rfid.sh', label: 'Radio id' },
  { script: 'get_basic_service_error_code.sh', label: 'Basic service errors' },
  { script: 'run_test.sh', label: 'Run self diagnostic' },
  { script: 'stop_sport_mode.sh', label: 'Stop sport mode', risky: true, note: 'The robot stops responding to motion commands' },
  { script: 'start_sport_mode.sh', label: 'Start sport mode' },
  { script: 'demarcate_turnon_clicker.sh', label: 'Calibration clicker on', risky: true },
  { script: 'demarcate_turnoff_clicker.sh', label: 'Calibration clicker off', risky: true },
]

// ---- UWB ----

export const UWB_API = { SWITCH: 1001 } as const

// ---- remote connection permission ----

/** enable_status is 2 to allow internet remote connections, 1 to forbid them. */
export const RM_CON_API = { GET_PERMISSION: 1001, SET_PERMISSION: 1002 } as const

// ---- gas sensor ----

export const GAS_SENSOR_API = { GET_STATE: 1002 } as const

/** Topics worth exposing in the subscription browser, with a short description. */
export const SUBSCRIBABLE_TOPICS: { topic: string; label: string; note: string }[] = [
  { topic: TOPICS.LOW_STATE, label: 'Low state', note: 'IMU, 12 motors, battery, foot force - high rate' },
  { topic: TOPICS.LF_SPORT_MOD_STATE, label: 'Sport state (lf)', note: 'mode, gait, velocity, body height' },
  { topic: TOPICS.SPORT_MOD_STATE, label: 'Sport state', note: 'same fields, unfiltered' },
  { topic: TOPICS.MULTIPLE_STATE, label: 'Multiple state', note: 'service status summary' },
  { topic: TOPICS.SERVICE_STATE, label: 'Service state', note: 'which onboard services are running' },
  { topic: TOPICS.ROBOTODOM, label: 'Robot pose', note: 'odometry from the lidar stack' },
  { topic: TOPICS.ULIDAR_STATE, label: 'Lidar state', note: 'lidar health and rotation' },
  { topic: TOPICS.SELF_TEST, label: 'Self test', note: 'startup diagnostics' },
  { topic: TOPICS.UWB_STATE, label: 'UWB state', note: 'ultra-wideband tracker, if fitted' },
  { topic: TOPICS.AUDIO_HUB_PLAY_STATE, label: 'Audio player state', note: 'what the speaker is playing' },
  { topic: TOPICS.GPT_FEEDBACK, label: 'GPT feedback', note: 'voice assistant flow events' },
  { topic: TOPICS.USLAM_LOC_ODOM, label: 'SLAM odometry', note: 'requires the mapping service' },
]

// ---- sport commands ----

/** Normal / AI mode api ids. */
export const SPORT_CMD = {
  Damp: 1001,
  BalanceStand: 1002,
  StopMove: 1003,
  StandUp: 1004,
  StandDown: 1005,
  RecoveryStand: 1006,
  Euler: 1007,
  Move: 1008,
  Sit: 1009,
  RiseSit: 1010,
  SwitchGait: 1011,
  Trigger: 1012,
  BodyHeight: 1013,
  FootRaiseHeight: 1014,
  SpeedLevel: 1015,
  Hello: 1016,
  Stretch: 1017,
  TrajectoryFollow: 1018,
  ContinuousGait: 1019,
  Content: 1020,
  Wallow: 1021,
  Dance1: 1022,
  Dance2: 1023,
  GetBodyHeight: 1024,
  GetFootRaiseHeight: 1025,
  GetSpeedLevel: 1026,
  SwitchJoystick: 1027,
  Pose: 1028,
  Scrape: 1029,
  FrontFlip: 1030,
  FrontJump: 1031,
  FrontPounce: 1032,
  WiggleHips: 1033,
  GetState: 1034,
  EconomicGait: 1035,
  FingerHeart: 1036,
  StandOut: 1039,
  LeftFlip: 1042,
  RightFlip: 1043,
  BackFlip: 1044,
  LeadFollow: 1045,
  FreeWalk: 1045,
  Standup: 1050,
  CrossWalk: 1051,
  Handstand: 1301,
  CrossStep: 1302,
  OnesidedStep: 1303,
  Bound: 1304,
  MoonWalk: 1305,
} as const

/**
 * MCF (Multi-Control Framework) api ids - firmware 1.1.7+. Same topic as normal
 * mode but a different id space: BackFlip is 2043 here, 1044 in normal mode.
 */
export const SPORT_CMD_MCF = {
  Damp: 1001,
  BalanceStand: 1002,
  StopMove: 1003,
  StandUp: 1004,
  StandDown: 1005,
  RecoveryStand: 1006,
  Euler: 1007,
  Move: 1008,
  Sit: 1009,
  RiseSit: 1010,
  SpeedLevel: 1015,
  Hello: 1016,
  Stretch: 1017,
  ContinuousGait: 1019,
  Content: 1020,
  Dance1: 1022,
  Dance2: 1023,
  GetSpeedLevel: 1026,
  SwitchJoystick: 1027,
  Pose: 1028,
  Scrape: 1029,
  FrontFlip: 1030,
  FrontJump: 1031,
  FrontPounce: 1032,
  GetState: 1034,
  Heart: 1036,
  SwitchGait: 1011,
  Wallow: 1021,
  WalkStair: 1049,
  StaticWalk: 1061,
  TrotRun: 1062,
  EconomicGait: 1063,
  LeftFlip: 2041,
  BackFlip: 2043,
  HandStand: 2044,
  FreeWalk: 2045,
  FreeBound: 2046,
  FreeJump: 2047,
  FreeAvoid: 2048,
  ClassicWalk: 2049,
  BackStand: 2050,
  CrossStep: 2051,
  RageMode: 2059,
  SetAutoRecovery: 2054,
  GetAutoRecovery: 2055,
  LeadFollow: 2056,
  SwitchAvoidMode: 2058,
} as const

/**
 * Which command set the robot's motion service speaks. This is NOT a menu of
 * modes to choose from: 'normal', 'ai' and 'advanced' are the three legacy
 * services, and 'mcf' is the single unified service that replaced all three on
 * firmware 1.1.7 and newer. The robot tells us which one it runs; the only
 * thing that is switchable is between the legacy three, and only on firmware
 * old enough to still have them.
 */
export type MotionMode = 'normal' | 'ai' | 'advanced' | 'mcf'

/** The legacy services a robot can be switched between; MCF is never one. */
export const SWITCHABLE_MODES = ['normal', 'ai', 'advanced'] as const

export interface ActionSpec {
  name: string
  label: string
  /** api id per motion mode; omit a mode where the action does not exist */
  ids: Partial<Record<MotionMode, number>>
  /** parameter sent with the request, if any */
  parameter?: unknown
  /** toggling actions take {data: true|false} */
  toggle?: boolean
  group: 'posture' | 'gesture' | 'gait' | 'dynamic' | 'assist'
  /** moves that need clear space - marked in the grid, never blocked */
  risky?: boolean
  /** gaits replace one another, so turning one on visibly releases the rest */
  exclusive?: boolean
  note?: string
}

export const ACTIONS: ActionSpec[] = [
  // stand and rest
  { name: 'BalanceStand', label: 'Ready stance', ids: { normal: 1002, ai: 1002, mcf: 1002 }, group: 'posture', note: 'Balanced and ready to walk. Run this after Stand up.' },
  { name: 'StandUp', label: 'Stand up', ids: { normal: 1004, ai: 1004, mcf: 1004 }, group: 'posture', note: 'Rises with the joints locked. Follow with Ready stance.' },
  { name: 'StandDown', label: 'Lie down', ids: { normal: 1005, ai: 1005, mcf: 1005 }, group: 'posture', note: 'Folds down and rests on the ground' },
  { name: 'Sit', label: 'Sit', ids: { normal: 1009, mcf: 1009 }, group: 'posture', note: 'Sits back on the hindquarters' },
  { name: 'RiseSit', label: 'Rise', ids: { normal: 1010, mcf: 1010 }, group: 'posture', note: 'Gets up out of a sit' },
  { name: 'RecoveryStand', label: 'Recover', ids: { normal: 1006, ai: 1006, mcf: 1006 }, group: 'posture', note: 'Rights the robot and stands it back up' },
  { name: 'Damp', label: 'Go limp', ids: { normal: 1001, ai: 1001, mcf: 1001 }, group: 'posture', note: 'Motors go slack and the robot settles to the floor' },
  { name: 'StopMove', label: 'Stand still', ids: { normal: 1003, ai: 1003, mcf: 1003 }, group: 'posture', note: 'Halts locomotion. Also leaves pose mode and most gaits.' },

  // walking styles
  { name: 'ClassicWalk', label: 'Normal walk', ids: { mcf: 2049 }, toggle: true, exclusive: true, group: 'gait', note: 'The everyday walking gait' },
  { name: 'StaticWalk', label: 'Careful walk', ids: { mcf: 1061 }, toggle: true, exclusive: true, group: 'gait', note: 'Slow and deliberate, keeping three feet down' },
  { name: 'FreeWalk', label: 'Terrain walk', ids: { mcf: 2045 }, toggle: true, exclusive: true, group: 'gait', note: 'Picks its own footing over uneven ground' },
  { name: 'TrotRun', label: 'Run', ids: { mcf: 1062 }, toggle: true, exclusive: true, group: 'gait', note: 'Faster running trot' },
  { name: 'RageMode', label: 'Sprint', ids: { mcf: 2059 }, toggle: true, exclusive: true, group: 'gait', risky: true, note: 'Fastest running mode. Needs a lot of open space.' },
  { name: 'WalkStair', label: 'Stair climbing', ids: { mcf: 1049 }, toggle: true, exclusive: true, group: 'gait', note: 'For stairs and tall obstacles. Approach steps straight on.' },
  { name: 'CrossStep', label: 'Crossover step', ids: { advanced: 1302, mcf: 2051 }, toggle: true, exclusive: true, group: 'gait', risky: true, note: 'Crosses the legs while stepping sideways' },
  { name: 'FreeBound', label: 'Terrain hop', ids: { mcf: 2046 }, toggle: true, exclusive: true, group: 'gait', risky: true, note: 'Bounding gait that adapts to rough ground' },
  { name: 'FreeJump', label: 'Auto jump', ids: { mcf: 2047 }, toggle: true, exclusive: true, group: 'gait', risky: true, note: 'Keeps walking and jumps obstacles it spots by itself' },
  { name: 'EconomicGait', label: 'Battery saver', ids: { normal: 1035, mcf: 1063 }, toggle: true, group: 'gait', note: 'Energy-saving walk that stretches the battery' },
  { name: 'ContinuousGait', label: 'March', ids: { normal: 1019, mcf: 1019 }, toggle: true, group: 'gait', note: 'Keeps stepping instead of standing still' },

  // tricks and greetings
  { name: 'Hello', label: 'Wave', ids: { normal: 1016, ai: 1016, mcf: 1016 }, group: 'gesture', note: 'Lifts a front paw and waves' },
  { name: 'Stretch', label: 'Stretch', ids: { normal: 1017, mcf: 1017 }, group: 'gesture', note: 'Stretches front then back, like waking up' },
  { name: 'FingerHeart', label: 'Heart', ids: { normal: 1036, mcf: 1036 }, group: 'gesture', note: 'Makes a heart shape with the front paws' },
  { name: 'Scrape', label: 'Paw ground', ids: { normal: 1029, mcf: 1029 }, group: 'gesture', note: 'Scrapes at the floor with a front leg' },
  { name: 'Dance1', label: 'Dance one', ids: { normal: 1022, mcf: 1022 }, group: 'gesture', risky: true, note: 'A short choreographed routine' },
  { name: 'Dance2', label: 'Dance two', ids: { normal: 1023, mcf: 1023 }, group: 'gesture', risky: true, note: 'A second, livelier routine' },

  // jumps and flips - all need space
  { name: 'FrontJump', label: 'Jump forward', ids: { normal: 1031, mcf: 1031 }, group: 'dynamic', risky: true, note: 'Jumps forward. Needs clear space ahead.' },
  { name: 'FrontPounce', label: 'Pounce', ids: { normal: 1032, mcf: 1032 }, group: 'dynamic', risky: true, note: 'Lunges forward. Needs clear space ahead.' },
  { name: 'FrontFlip', label: 'Front flip', ids: { normal: 1030, mcf: 1030 }, parameter: { data: true }, group: 'dynamic', risky: true, note: 'Needs clear space and a soft floor' },
  { name: 'BackFlip', label: 'Back flip', ids: { ai: 1044, mcf: 2043 }, parameter: { data: true }, group: 'dynamic', risky: true, note: 'Needs clear space and a soft floor' },
  { name: 'LeftFlip', label: 'Left flip', ids: { ai: 1042, mcf: 2041 }, parameter: { data: true }, group: 'dynamic', risky: true, note: 'Sideways flip. Needs clear space and a soft floor.' },
  { name: 'Handstand', label: 'Handstand', ids: { ai: 1039, advanced: 1301, mcf: 2044 }, toggle: true, group: 'dynamic', risky: true, note: 'Balances on the front legs, hind legs in the air. Press again to come down.' },
  { name: 'BackStand', label: 'Hind stand', ids: { mcf: 2050 }, toggle: true, group: 'dynamic', risky: true, note: 'Rears up onto the back legs, front paws in the air. The opposite of a handstand.' },

  // follows you or steers itself
  { name: 'LeadFollow', label: 'Walk with me', ids: { ai: 1045, mcf: 2056 }, toggle: true, group: 'assist', note: 'Walks alongside and follows a person' },
  { name: 'FreeAvoid', label: 'Auto avoid', ids: { mcf: 2048 }, toggle: true, group: 'assist', note: 'Steers around obstacles on its own' },

  // Sits with the postures: it is a way of standing, and while it is on the
  // drive sticks lean the body instead of walking it.
  { name: 'Pose', label: 'Pose mode', ids: { normal: 1028, mcf: 1028 }, toggle: true, group: 'posture', note: 'Feet stay planted and the drive sticks lean the body' },
]

export const ACTION_GROUPS: { key: ActionSpec['group']; label: string; note: string }[] = [
  { key: 'posture', label: 'Stand and rest', note: 'Postures and holding still' },
  { key: 'gait', label: 'Walking styles', note: 'Picking one replaces the last' },
  { key: 'gesture', label: 'Tricks & greetings', note: 'One-off routines' },
  { key: 'dynamic', label: 'Jumps & flips', note: 'Needs two metres of clear, soft, level floor' },
  { key: 'assist', label: 'Follow and avoid', note: 'The robot steers itself' },
]

/** Sport calls that read a value back rather than moving the robot. */
export const SPORT_QUERIES = [
  { label: 'Pace setting', apiId: SPORT_CMD.GetSpeedLevel },
  { label: 'Full state', apiId: SPORT_CMD.GetState, parameter: ['state', 'bodyHeight', 'speedLevel', 'gait', 'continuousGait', 'economicGait'] },
]

// ---- motion switcher ----

export const MOTION_SWITCHER_API = { GET_MODE: 1001, SET_MODE: 1002, RELEASE_MODE: 1003, SET_SILENT: 1004, GET_SILENT: 1005 } as const

// ---- vui: lights and volume ----

export const VUI_API = {
  SET_SWITCH: 1001,
  GET_SWITCH: 1002,
  SET_VOLUME: 1003,
  GET_VOLUME: 1004,
  SET_BRIGHTNESS: 1005,
  GET_BRIGHTNESS: 1006,
  SET_COLOR: 1007,
  /** Hands the light back to the firmware, clearing a set colour. */
  RELEASE_COLOR: 1008,
  LED_OFF: 1008,
} as const

export const VUI_COLORS = ['white', 'red', 'yellow', 'blue', 'green', 'cyan', 'purple'] as const
export type VuiColor = (typeof VUI_COLORS)[number]

/** Hex approximations for the swatches - the robot only accepts the names above. */
export const VUI_COLOR_HEX: Record<VuiColor, string> = {
  white: '#f4f6fa',
  red: '#e5484d',
  yellow: '#e8b93e',
  blue: '#3d7fe8',
  green: '#43c478',
  cyan: '#52c8ef',
  purple: '#a855f7',
}

// ---- audio hub ----

export const AUDIO_API = {
  GET_AUDIO_LIST: 1001,
  SELECT_START_PLAY: 1002,
  PAUSE: 1003,
  UNSUSPEND: 1004,
  SELECT_PREV_START_PLAY: 1005,
  SELECT_NEXT_START_PLAY: 1006,
  SET_PLAY_MODE: 1007,
  SELECT_RENAME: 1008,
  SELECT_DELETE: 1009,
  GET_PLAY_MODE: 1010,
  UPLOAD_AUDIO_FILE: 2001,
  PLAY_START_OBSTACLE_AVOIDANCE: 3001,
  PLAY_EXIT_OBSTACLE_AVOIDANCE: 3002,
  PLAY_START_COMPANION_MODE: 3003,
  PLAY_EXIT_COMPANION_MODE: 3004,
  ENTER_MEGAPHONE: 4001,
  EXIT_MEGAPHONE: 4002,
  UPLOAD_MEGAPHONE: 4003,
  INTERNAL_LONG_CORPUS_SELECT_TO_PLAY: 5001,
  INTERNAL_LONG_CORPUS_PLAYBACK_COMPLETED: 5002,
  INTERNAL_LONG_CORPUS_STOP_PLAYING: 5003,
} as const

export const PLAY_MODES = ['single_cycle', 'no_cycle', 'list_loop'] as const

// ---- obstacle avoidance ----

export const OBSTACLES_AVOID_API = {
  SWITCH_SET: 1001,
  SWITCH_GET: 1002,
  MOVE: 1003,
  USE_REMOTE_COMMAND_FROM_API: 1004,
} as const

// ---- gaits reported in sport state ----

export const GAITS = [
  { value: 0, label: 'Idle' },
  { value: 1, label: 'Trot' },
  { value: 2, label: 'Run' },
  { value: 3, label: 'Climb stairs' },
  { value: 4, label: 'Down stairs' },
] as const

// ---- error tables ----

export const ERROR_SOURCES: Record<string, string> = {
  '100': 'Communication firmware',
  '200': 'Cooling fans',
  '300': 'Motors',
  '400': 'Lidar',
  '500': 'UWB',
  '600': 'Motion control',
}

export const ERROR_CODES: Record<string, string> = {
  '100_1': 'DDS message timeout',
  '100_2': 'Distribution switch abnormal',
  '100_10': 'Battery communication error',
  '100_20': 'Remote control communication abnormal',
  '100_40': 'MCU communication error',
  '100_80': 'Motor communication error',
  '200_1': 'Rear left fan jammed',
  '200_2': 'Rear right fan jammed',
  '200_4': 'Front fan jammed',
  '300_1': 'Overcurrent',
  '300_2': 'Overvoltage',
  '300_4': 'Driver overheating',
  '300_8': 'Bus undervoltage',
  '300_10': 'Winding overheating',
  '300_20': 'Encoder abnormal',
  '300_100': 'Motor communication interruption',
  '400_1': 'Motor rotation speed abnormal',
  '400_2': 'Point cloud data abnormal',
  '400_4': 'Serial port data abnormal',
  '400_10': 'Abnormal dirt index',
  '500_1': 'UWB serial port open abnormal',
  '500_2': 'Robot information retrieval abnormal',
  '600_4': 'Overheating software protection',
  '600_8': 'Low battery software protection',
}

// Firmware also reports per-motor faults on sources 301-399 and 3000-3999,
// and the battery on 700; all reuse source 300's bit catalogue.
const ERROR_SOURCES_EXTRA: Record<string, string> = {
  '700': 'Battery',
}

// Codes that only appear on the wheeled Go2-W, in the motor 300 range.
const ERROR_CODES_WHEEL: Record<string, string> = {
  '300_40': 'Calibration data abnormal',
  '300_80': 'Abnormal reset',
}

export function describeError(source: number | string, code: number): { source: string; text: string } {
  const src = String(source)
  const n = Number(src)
  const hex = code.toString(16).toUpperCase()

  // Per-motor sources map back onto the motor bit catalogue (source 300).
  let label = ERROR_SOURCES[src] ?? ERROR_SOURCES_EXTRA[src]
  let catalogue = src
  if (!label && n >= 301 && n <= 399) {
    label = `Motor ${n - 300}`
    catalogue = '300'
  } else if (!label && n >= 3000 && n <= 3999) {
    label = `Motor ${n % 100}`
    catalogue = '300'
  }

  return {
    source: label ?? `Source ${src}`,
    text: ERROR_CODES[`${catalogue}_${hex}`] ?? ERROR_CODES_WHEEL[`${catalogue}_${hex}`] ?? `Unknown code ${src}-${hex}`,
  }
}

/**
 * The status codes a robot returns on an api response header (distinct from the
 * hardware fault codes above). Used to explain a failed request instead of just
 * echoing the number. Transcribed from legion1581/go2_python_sdk
 * (DDS_ERROR_DESCRIPTIONS).
 */
export const API_STATUS_CODES: Record<number, string> = {
  4101: 'Wrong number of trajectory points',
  4201: 'The action timed out',
  4205: 'The motion service is not ready yet',
  4206: 'Wrong posture for this action - try Balance stand first',
  3001: 'Request sent but no response',
  3102: 'Request rejected: another client holds the lease',
  3103: 'API not registered on the robot',
  3104: 'Request timed out',
  3107: 'Invalid lease',
  3201: 'Response error',
  3202: 'Internal server error',
  3203: 'API not implemented on this firmware',
  3204: 'Parameter error',
  3205: 'Request rejected',
  3206: 'Invalid lease',
  3207: 'A lease already exists',
}

// ---- motor layout ----

/** Joint order in lowstate.motor_state (0-11). */
export const MOTOR_NAMES = [
  'FR hip', 'FR thigh', 'FR calf',
  'FL hip', 'FL thigh', 'FL calf',
  'RR hip', 'RR thigh', 'RR calf',
  'RL hip', 'RL thigh', 'RL calf',
]

export const FOOT_NAMES = ['Front right', 'Front left', 'Rear right', 'Rear left']

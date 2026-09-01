// Telemetry payload shapes as delivered over the WebRTC data channel.
// Fields are optional/loose - firmware versions vary. Verified against
// unitree_go ROS message definitions and community webrtc drivers.

export interface ImuState {
  quaternion?: number[]
  gyroscope?: number[]
  accelerometer?: number[]
  rpy?: number[]
  temperature?: number
}

export interface MotorState {
  mode?: number
  q?: number
  dq?: number
  ddq?: number
  tau_est?: number
  temperature?: number
  lost?: number
  [k: string]: unknown
}

export interface BmsState {
  version_high?: number
  version_low?: number
  status?: number
  soc?: number
  current?: number
  cycle?: number
  bq_ntc?: number[]
  mcu_ntc?: number[]
  cell_vol?: number[]
  [k: string]: unknown
}

export interface LowState {
  imu_state?: ImuState
  motor_state?: MotorState[]
  bms_state?: BmsState
  foot_force?: number[]
  foot_force_est?: number[]
  tick?: number
  power_v?: number
  power_a?: number
  temperature_ntc1?: number
  temperature_ntc2?: number
  fan_frequency?: number[]
  bit_flag?: number
  [k: string]: unknown
}

export interface SportModeState {
  error_code?: number
  imu_state?: ImuState
  mode?: number
  progress?: number
  gait_type?: number
  foot_raise_height?: number
  position?: number[]
  body_height?: number
  velocity?: number[]
  yaw_speed?: number
  range_obstacle?: number[]
  foot_force?: number[]
  foot_position_body?: number[]
  foot_speed_body?: number[]
  [k: string]: unknown
}

export interface RobotError {
  ts: number
  source: string
  text: string
  cleared?: boolean
}

export interface DiscoveredRobot {
  ip: string
  sn?: string
  name?: string
}

/**
 * How the browser reaches the robot, as the operator picks it. 'lan' is the
 * no-typing case - robot and this machine on the same router, found by a scan -
 * and it resolves to a plain address before the connection is opened, so the
 * wire only ever sees the four transports in ConnectOptions.
 */
export type ConnectMethod = 'ip' | 'serial' | 'ap' | 'lan' | 'cloud'

export interface CloudRobot {
  sn: string
  name?: string
  online?: boolean | number | string
  /** per-device key, also used for the local handshake on firmware >= 1.1.15 */
  aesKey: string
}

/**
 * Transcribed from unitree_ui's GO2_MODE_MAP (legacy normal/advanced/ai
 * `mode` enum - see lib/motionState.ts, which shares this table). The
 * previous version guessed labels for 4, 9 and 11-13 with nothing to back
 * them; a mode absent here falls back to the raw number in StatusPanel rather
 * than showing an invented name.
 */
export const MODE_NAMES: Record<number, string> = {
  0: 'idle',
  1: 'balance stand',
  2: 'pose',
  3: 'locomotion',
  5: 'lie down',
  6: 'joint lock',
  7: 'damping',
  8: 'recovery stand',
  9: 'free walk',
  10: 'sit',
  15: 'free bound',
  16: 'free jump',
  17: 'free avoid',
  18: 'stair',
  19: 'stand',
  20: 'cross step',
}


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

/** How the browser reaches the robot. */
export type ConnectMethod = 'ip' | 'serial' | 'ap' | 'cloud'

export interface CloudRobot {
  sn: string
  name?: string
  online?: boolean | number | string
  /** per-device key, also used for the local handshake on firmware >= 1.1.15 */
  aesKey: string
}

export const MODE_NAMES: Record<number, string> = {
  0: 'idle',
  1: 'balance stand',
  2: 'pose',
  3: 'locomotion',
  4: 'reserved',
  5: 'lie down',
  6: 'jointLock',
  7: 'damping',
  8: 'recovery stand',
  9: 'reserved',
  10: 'sit',
  11: 'front flip',
  12: 'front jump',
  13: 'front pounce',
}

export const GAIT_NAMES: Record<number, string> = {
  0: 'idle',
  1: 'trot',
  2: 'run',
  3: 'climb stairs',
  4: 'forward down stairs',
  9: 'adjust',
}

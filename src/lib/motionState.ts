// What the robot says it is doing, decoded from sportmodestate and translated
// into this console's own ACTIONS names.
//
// The Actions grid used to light a tile purely from whether its own request had
// resolved - an optimistic map, reset on every motion-mode change and never
// once compared against what the robot actually reported. A mode that engaged
// looked identical to one that silently failed, because both left the tile in
// whatever state the last click set it to. The robot does report which mode it
// is running; this file is the translation from that report to a tile name, so
// the grid can be lit by fact instead of hope.
//
// Two different wire shapes carry the same information. On normal / advanced /
// ai firmware the active mode is a small enum in `mode` (0-20), with a few
// states that share mode value 0 or 1 distinguished instead by bits in
// `error_code`. On mcf firmware `mode` stays 0 throughout, and `error_code`
// becomes a full mode CODE instead of a bitfield. Transcribed from
// unitree_ui/src/ui/components/action-bar.ts (go2DecodeState /
// go2DecodeStateMcf), which is itself reverse-engineered from the official
// app - treat every mapping here as no more certain than that source is.
//
// Deliberately does not attempt to tell the three plain walking gaits
// (ClassicWalk / StaticWalk / TrotRun) apart from `gait_type` alone: the
// firmware reports which gait pattern is active (trot, run, stair), not which
// of this console's own buttons produced it, and guessing would put an
// uncorroborated tile-name mapping right back into the code this file exists
// to get rid of. Those three stay purely optimistic until a hardware capture
// says otherwise.

export interface SportModeSnapshot {
  mode?: number
  gait_type?: number
  error_code?: number
}

/** legacy (normal / advanced / ai) `mode` enum. */
const GO2_MODE_MAP: Record<number, string> = {
  0: 'idle',
  1: 'balanceStand',
  2: 'pose',
  3: 'locomotion',
  5: 'lieDown',
  6: 'jointLock',
  7: 'damping',
  8: 'recoveryStand',
  9: 'freeWalk',
  10: 'sit',
  15: 'freeBound',
  16: 'freeJump',
  17: 'freeAvoid',
  18: 'stair',
  19: 'stand',
  20: 'crossStep',
}

/** mcf `error_code` full mode code. */
const GO2_ERR_MODE_MAP: Record<number, string> = {
  0: 'idle',
  100: 'freeWalk',
  1001: 'damping',
  1002: 'jointLock',
  1004: 'lieDown',
  1005: 'move',
  1006: 'hello',
  1007: 'sit',
  1013: 'balanceStand',
  1015: 'walk',
  1016: 'run',
  1017: 'batteryLife',
  1091: 'pose',
  2007: 'freeAvoid',
  2008: 'freeBound',
  2009: 'freeJump',
  2010: 'stair',
  2011: 'handStand',
  2016: 'crossStep',
  2017: 'backStand',
  2019: 'leadFollow',
  2021: 'rageMode',
}

/** Which of our own ACTIONS names lights up for a decoded state, where that
 *  mapping is unambiguous. States with no entry here (idle, balanceStand,
 *  sit, damping, jointLock, lieDown, recoveryStand, walk, run, ...) are real,
 *  but do not correspond to a single grid tile - either nothing should light,
 *  or (walk/run) more than one tile plausibly could and we do not guess. */
const STATE_TO_ACTION: Record<string, string> = {
  freeWalk: 'FreeWalk',
  freeBound: 'FreeBound',
  freeJump: 'FreeJump',
  freeAvoid: 'FreeAvoid',
  stair: 'WalkStair',
  crossStep: 'CrossStep',
  batteryLife: 'EconomicGait',
  leadFollow: 'LeadFollow',
  handStand: 'Handstand',
  backStand: 'BackStand',
  rageMode: 'RageMode',
  pose: 'Pose',
  continuousWalk: 'ContinuousGait',
  continuousRun: 'ContinuousGait',
}

const GO2_GAIT = ['idle', 'walk', 'run', 'stair', 'downStair', 'adjust']

/** Decode a legacy (normal / advanced / ai) sportmodestate frame. */
export function decodeLegacyState(d: SportModeSnapshot): string {
  const mode = d.mode ?? 0
  const gait = d.gait_type ?? 0
  const err = d.error_code ?? 0
  if (!mode) return 'balanceStand'
  if ((err >> 1) & 1) return 'standOut'
  const continuousGait = err & 1
  if ((err >> 4) & 1) return 'batteryLife'
  if ((err >> 5) & 1) return 'leadFollow'
  const state = GO2_MODE_MAP[mode]
  const gaitName = GO2_GAIT[gait] ?? 'walk'
  if (!state || state === 'idle') return 'balanceStand'
  if (state === 'damping' || state === 'jointLock') return state
  const locomotionGaits = ['run', 'stair', 'downStair']
  if (state === 'locomotion' || locomotionGaits.includes(gaitName) || continuousGait === 1) {
    switch (gaitName) {
      case 'walk':
        return continuousGait ? 'continuousWalk' : 'walk'
      case 'run':
        return continuousGait ? 'continuousRun' : 'run'
      case 'stair':
        return 'stair'
      case 'downStair':
        return 'downStair'
      default:
        return 'walk'
    }
  }
  return state
}

/**
 * Decode one mcf `error_code`. mcf persists the last real mode across a
 * BalanceStand / idle / unknown frame instead of dropping back to nothing -
 * under mcf you stay "in" the chosen gait, on the wire, until you switch to
 * another - so the caller threads `lastState` through frame to frame.
 */
export function decodeMcfState(errorCode: number, lastState: string): { state: string; lastState: string } {
  if (!errorCode) return { state: 'freeWalk', lastState }
  const mapped = GO2_ERR_MODE_MAP[errorCode]
  if (mapped === 'idle' || mapped === 'hello') return { state: 'freeWalk', lastState }
  if (mapped === 'balanceStand' || !mapped) return { state: lastState, lastState }
  return { state: mapped, lastState: mapped }
}

/** Decode a sportmodestate frame for whichever service is running. */
export function decodeMotionState(
  d: SportModeSnapshot,
  motionMode: string,
  mcfLastState = 'freeWalk',
): { state: string; mcfLastState: string } {
  if (motionMode === 'mcf') {
    const { state, lastState } = decodeMcfState(d.error_code ?? 0, mcfLastState)
    return { state, mcfLastState: lastState }
  }
  return { state: decodeLegacyState(d), mcfLastState }
}

/** The ACTIONS name currently engaged, or null when nothing this console
 *  tracks is running - most states (idle, standing, sitting, a plain walk)
 *  correctly light nothing. */
export function actionNameFor(state: string): string | null {
  return STATE_TO_ACTION[state] ?? null
}

/**
 * Which ACTIONS names telemetry can ever confirm. A tile in this set should
 * never be shown lit from optimism alone - if the robot is not reporting it,
 * it is not on, however recently the request succeeded.
 */
export const TRACKED_ACTION_NAMES: ReadonlySet<string> = new Set(Object.values(STATE_TO_ACTION))

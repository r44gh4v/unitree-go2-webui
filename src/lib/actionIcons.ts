// Maps each sport action to its icon from the bundled set (originally the
// Unitree Go app symbols, via legion1581/unitree_ui, MIT - see
// src/assets/actions/ATTRIBUTION.md). Actions without a matching symbol simply
// render no icon. Icons load as raw SVG strings so they inherit the text colour.

const raw = import.meta.glob('../assets/actions/*.svg', { query: '?raw', import: 'default', eager: true }) as Record<
  string,
  string
>

/** filename (without extension) -> raw svg markup */
const byFile: Record<string, string> = {}
for (const [path, svg] of Object.entries(raw)) {
  const name = path.split('/').pop()!.replace('.svg', '')
  byFile[name] = svg
}

/** action name (from constants) -> icon filename */
const ACTION_ICON: Record<string, string> = {
  // posture
  BalanceStand: 'mode_stand',
  StandUp: 'mode_stand',
  StandDown: 'lieDown',
  RecoveryStand: 'mode_stand',
  Sit: 'sitDown',
  RiseSit: 'mode_stand',
  Damp: 'mode_damping',
  StopMove: 'mode_locking',
  Pose: 'mode_pose',
  // gestures
  Hello: 'shakeHands',
  Stretch: 'stretch',
  Scrape: 'mode_sideStep',
  FingerHeart: 'showHeart',
  Dance1: 'dance1',
  Dance2: 'dance2',
  Wallow: 'rollOver',
  // gaits
  EconomicGait: 'mode_batteryLife',
  ContinuousGait: 'mode_keepMoving',
  StaticWalk: 'mode_walk',
  TrotRun: 'mode_run',
  ClassicWalk: 'mode_classic',
  FreeWalk: 'mode_freeWalk',
  CrossStep: 'mode_crossStep',
  WalkStair: 'mode_climbingStairs',
  RageMode: 'mode_highSpeed',
  OnesidedStep: 'mode_sideStep',
  Bound: 'mode_bound',
  FreeBound: 'mode_ai_bound',
  LeadFollow: 'mode_runSideBySide',
  // dynamic
  FrontJump: 'jumpForward',
  FreeJump: 'jumpForward',
  FrontPounce: 'pounceForward',
  FrontFlip: 'turnOver',
  BackFlip: 'turnOver',
  LeftFlip: 'turnOver',
  RightFlip: 'turnOver',
  Handstand: 'hand_stand',
  FreeAvoid: 'mode_ai_avoid',
  // Not hand_stand: this is the opposite move, and sharing the inverted symbol
  // with Handstand is what made the two look like duplicates in the first place.
  BackStand: 'mode_climbing',
}

/** Raw SVG markup for an action, or null when there is no matching symbol. */
export function actionIconSvg(name: string): string | null {
  const file = ACTION_ICON[name]
  return file ? (byFile[file] ?? null) : null
}

// Maps a W3C Gamepad's buttons to the Unitree wireless-controller `keys`
// bitmask - the same 16-bit layout the handheld remote sends, so a plugged-in
// pad's face buttons reach the robot exactly as the real controller's would.
//
// Button indices are the W3C "standard" mapping; a pad that reports a different
// mapping simply contributes whatever bits line up. Layout transcribed from
// legion1581/unitree_ui (gamepad-manager.ts).

/** [standard-mapping button index, bit position in `keys`] */
const BUTTON_BITS: [number, number][] = [
  [5, 0], // R1
  [4, 1], // L1
  [9, 2], // Start
  [8, 3], // Select
  [7, 4], // R2
  [6, 5], // L2
  [10, 6], // F1 (left stick press)
  [11, 7], // F2 (right stick press)
  [0, 8], // A
  [1, 9], // B
  [2, 10], // X
  [3, 11], // Y
  [12, 12], // Up
  [15, 13], // Right
  [13, 14], // Down
  [14, 15], // Left
]

/** Build the 16-bit `keys` value from the pressed buttons on a gamepad. */
export function gamepadKeys(pad: Gamepad): number {
  let keys = 0
  const b = pad.buttons
  for (const [idx, bit] of BUTTON_BITS) {
    if (b[idx]?.pressed) keys |= 1 << bit
  }
  return keys
}

/** The first connected gamepad, or null. */
export function firstGamepad(): Gamepad | null {
  for (const p of navigator.getGamepads()) {
    if (p) return p
  }
  return null
}

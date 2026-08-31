// How much the robot is saying, per second.
//
// This is the one reading that tells a live robot from a frozen one. Battery,
// temperature and posture all look perfectly healthy when the link has died,
// because they are simply the last values that arrived - only this number
// notices that nothing new is coming.
//
// Pure arithmetic over a running counter, so it is tested directly rather than
// by watching a panel.

/** Readings closer together than this are noise, not signal. */
export const RATE_WINDOW_MS = 500

/** How much of the previous reading survives into the next. */
const SMOOTHING = 0.5

export class MessageRate {
  private lastCount = 0
  private lastAt = 0
  private started = false
  private rate = 0

  /**
   * Offer the running message count. Returns the current smoothed rate, which
   * only moves once a full window has passed.
   */
  sample(messages: number, atMs: number): number {
    if (!this.started) {
      this.started = true
      this.lastCount = messages
      this.lastAt = atMs
      return this.rate
    }

    const elapsed = (atMs - this.lastAt) / 1000
    if (elapsed < RATE_WINDOW_MS / 1000) return this.rate

    // A counter that went backwards is a new link, not negative traffic: the
    // count restarts at zero on reconnect. Taking the raw count as the delta
    // reads a fresh healthy link as healthy instead of as dead.
    const delta = messages >= this.lastCount ? messages - this.lastCount : messages
    const instant = delta / elapsed

    // The first real reading is taken as-is. Blending it toward an average of
    // zero would report half the true rate on a link that just came up.
    this.rate = this.rate === 0 ? instant : this.rate * SMOOTHING + instant * (1 - SMOOTHING)
    this.lastCount = messages
    this.lastAt = atMs
    return this.rate
  }

  /** Start over, for a link that has been torn down. */
  reset() {
    this.lastCount = 0
    this.lastAt = 0
    this.started = false
    this.rate = 0
  }
}

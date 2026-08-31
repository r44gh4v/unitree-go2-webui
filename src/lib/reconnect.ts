// Whether a lost link should be reopened, and when.
//
// Recovery is a policy, not a mechanism. The mechanism is connect(); the policy
// is the set of rules deciding when calling it again is the right thing to do.
// Those rules used to live as four separate refs threaded through a React
// effect, where the only way to know what they did together was to hold all
// four in your head at once. Here they are one module with five entry points,
// readable and testable without a browser, a robot, or a React tree.
//
// This file imports nothing on purpose: node strips the type annotations and
// loads it straight from source, so the tests run against the real thing.

/**
 * Waits before each successive attempt. Five of them, spanning about half a
 * minute: long enough to ride out an access point handover or a router reboot,
 * short enough that a robot which is genuinely switched off stops being
 * knocked on while the operator waits to be told.
 */
export const DEFAULT_SCHEDULE = [1000, 2000, 4000, 8000, 15000]

/** Why recovery declined to act, for the operator-facing message. */
export type Standing =
  /** The operator hung up. Their choice is not a fault to recover from. */
  | 'hung-up'
  /** These details have never produced a link, so there is nothing to restore. */
  | 'never-worked'
  /** No connection has ever been attempted. */
  | 'nothing-to-reopen'

export type Recovery<T> =
  | { act: 'reopen'; after: number; attempt: number; of: number; details: T }
  | { act: 'give-up' }
  | { act: 'stand-down'; why: Standing }

/**
 * Tracks one operator's connection intent across drops and retries.
 *
 * The caller's whole job is: say what is happening (opening, established,
 * abandoned), then ask what to do when a link ends. It never has to reason
 * about attempt counts, or whether a failure is worth retrying, or whether the
 * operator wanted this.
 */
export class ReconnectPolicy<T> {
  private details: T | null = null
  private worked = false
  private quit = false
  private attempt = 0
  private readonly schedule: readonly number[]

  constructor(schedule: readonly number[] = DEFAULT_SCHEDULE) {
    this.schedule = schedule
  }

  /**
   * The operator is opening a link. This is a fresh intent: whatever the last
   * set of details did, these have proved nothing yet.
   */
  opening(details: T) {
    this.details = details
    this.worked = false
    this.quit = false
    this.attempt = 0
  }

  /**
   * Recovery is reopening the same link. Deliberately not `opening`: a retry
   * must not reset the attempt count it is part of, or it would retry forever.
   */
  reopening() {
    this.quit = false
  }

  /** The link came up. Whatever went wrong before is spent. */
  established() {
    this.worked = true
    this.attempt = 0
  }

  /** The operator hung up. */
  abandoned() {
    this.quit = true
    this.worked = false
  }

  /**
   * The link ended. Decides what happens next and counts the attempt, so
   * asking twice for one loss is a caller bug rather than a silent extra try.
   */
  afterLoss(): Recovery<T> {
    if (this.quit) return { act: 'stand-down', why: 'hung-up' }
    if (this.details === null) return { act: 'stand-down', why: 'nothing-to-reopen' }
    // Recovery restores a link that worked. A first attempt that fails is a
    // wrong address or a robot that is off, and repeating it just delays the
    // operator finding out which.
    if (!this.worked) return { act: 'stand-down', why: 'never-worked' }
    if (this.attempt >= this.schedule.length) return { act: 'give-up' }

    const after = this.schedule[this.attempt]
    this.attempt += 1
    return { act: 'reopen', after, attempt: this.attempt, of: this.schedule.length, details: this.details }
  }
}

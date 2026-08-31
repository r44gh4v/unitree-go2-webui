// Reading the robot's fault frames.
//
// Faults arrive in two shapes across three frame types, and the difference is
// only visible in the nesting: a single row is [time, source, code], a batch is
// an array of those. Reading a batch of one as a row of three numbers, or the
// reverse, loses the fault entirely - and a lost fault is the worst kind,
// because the console goes on looking calm while the robot is reporting a
// problem nobody can see.
//
// Anything that does not describe a fault is dropped rather than guessed at.
// A partial row is not a fault with defaults filled in; it is a frame this does
// not understand, and inventing a source or a code for it would put a fiction
// in the fault list.

import { DATA_CHANNEL_TYPE, describeError } from './constants.ts'

/**
 * How many faults are kept. A burst during a fall can be dozens, and the
 * operator needs to see what started it, not just the last few.
 */
export const FAULT_LIMIT = 80

export interface RobotFault {
  /** Milliseconds, converted from the robot's unix seconds. */
  ts: number
  /** The named subsystem, not the raw number. */
  source: string
  text: string
  /** True when the robot is reporting that this fault has gone. */
  cleared: boolean
}

/** A row carries a time, a source and a code. Anything less is not a fault. */
function isFaultRow(row: unknown): row is number[] {
  return Array.isArray(row) && row.length >= 3
}

/**
 * Read one fault frame into zero or more faults.
 *
 * `frameType` is the data-channel type: rm_error means the robot is saying a
 * fault has cleared. Those still come through, marked, so the list can show
 * what stopped rather than silently shrinking and leaving the operator to
 * notice a count change.
 */
export function parseFaultFrame(frameType: string, data: unknown): RobotFault[] {
  if (!Array.isArray(data) || data.length === 0) return []

  // The nesting is what separates a batch from a single row.
  const rows: unknown[] = Array.isArray(data[0]) ? data : [data]
  const cleared = frameType === DATA_CHANNEL_TYPE.RM_ERROR

  const out: RobotFault[] = []
  for (const row of rows) {
    if (!isFaultRow(row)) continue
    const [ts, source, code] = row
    const described = describeError(source, code)
    out.push({ ts: ts * 1000, source: described.source, text: described.text, cleared })
  }
  return out
}

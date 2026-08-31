// Values that may or may not have been decoded yet.
//
// The robot sends the same field as a JSON string on one topic and as a real
// object on another, and which it does can change with firmware. Every reader
// has to cope with both, so the coping lives here rather than being rewritten
// per topic - two places had already grown their own version, and they did not
// agree about what to do with a string that is not JSON at all.
//
// The rule is: decode if it can be decoded, otherwise hand back what arrived.
// A caller asking to parse a wire value is asking for help, not insisting the
// value be JSON - some topics genuinely carry plain text, and throwing on those
// would lose a reading the operator could have read perfectly well.

/**
 * Decode a value the robot may have sent as a JSON string.
 *
 * Anything already decoded passes through. A string is parsed when it can be,
 * and returned unchanged when it cannot. Absence - null, undefined, or the
 * empty string - comes back as null, so callers have one thing to check.
 */
export function parseMaybeJson<T = unknown>(value: unknown): T | null {
  if (value == null || value === '') return null
  if (typeof value !== 'string') return value as T
  try {
    // Note this can legitimately produce null, from the string "null".
    return JSON.parse(value) as T
  } catch {
    // Not JSON, so it was plain text all along.
    return value as unknown as T
  }
}

// A remembered Unitree account session.
//
// Signing in returns an access token and the robots bound to the account. Both
// are cached so a reload does not mean signing in again, and the rules for
// whether a cached one is still usable are here - the only part of the flow
// that is pure, and the part where being wrong is expensive: a stale token
// shows the operator robots they cannot reach and fails at connect time
// instead of at sign-in time, where the reason would have been obvious.
//
// Imports nothing, so the rules can be tested directly.

/** How long a cached session is trusted before the operator signs in again. */
export const SESSION_TTL_MS = 24 * 60 * 60 * 1000

export interface CloudRobot {
  sn: string
  name?: string
  aesKey?: string
}

export interface CloudSession {
  token: string
  robots: CloudRobot[]
}

/**
 * Read a cached session, or null if there is nothing usable.
 *
 * Refuses anything it cannot judge rather than guessing: no token, no robots, a
 * robot with no serial (the serial is what gets connected to), an age past the
 * window, and a save with no timestamp or one stamped in the future - where the
 * clock has moved or the value was tampered with, and either way the age cannot
 * be trusted.
 */
export function readStoredSession(raw: string | null, now: number, ttlMs: number = SESSION_TTL_MS): CloudSession | null {
  if (!raw) return null

  let saved: unknown
  try {
    saved = JSON.parse(raw)
  } catch {
    return null
  }
  if (!saved || typeof saved !== 'object') return null

  const { token, robots, at } = saved as { token?: unknown; robots?: unknown; at?: unknown }
  if (typeof token !== 'string' || !token) return null
  if (!Array.isArray(robots) || !robots.length) return null
  if (robots.some((r) => !r || typeof (r as CloudRobot).sn !== 'string' || !(r as CloudRobot).sn)) return null

  if (typeof at !== 'number' || !Number.isFinite(at)) return null
  const age = now - at
  if (age < 0 || age > ttlMs) return null

  return { token, robots: robots as CloudRobot[] }
}

/** The shape written to storage, so the reader and the writer cannot drift. */
export function storeSession(session: CloudSession, now: number): string {
  return JSON.stringify({ token: session.token, robots: session.robots, at: now })
}

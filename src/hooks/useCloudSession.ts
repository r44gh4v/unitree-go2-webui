import { useCallback, useEffect, useState } from 'react'
import { readStoredSession, storeSession, type CloudRobot, type CloudSession } from '../lib/cloudSession'

/**
 * Being signed in to a Unitree account.
 *
 * Signing in, remembering it across reloads, expiring it and signing out are
 * one job with one interface. They used to be four pieces of state, an effect
 * and two handlers inline in the connect panel, where they sat between a form
 * and a network scan and could not be exercised without rendering the panel.
 *
 * The rules for whether a remembered session is still usable are in
 * lib/cloudSession.ts, where they are tested on their own.
 */

const STORE_KEY = 'go2.cloudSession'

export interface CloudSessionApi {
  /** Access token for the cloud relay, or '' when signed out. */
  token: string
  /** Robots bound to the account, or null when signed out. */
  robots: CloudRobot[] | null
  signingIn: boolean
  /** Resolves to the robots found, or throws with a reason to show. */
  signIn: (email: string, password: string, region: string) => Promise<CloudRobot[]>
  signOut: () => void
}

export function useCloudSession(): CloudSessionApi {
  const [session, setSession] = useState<CloudSession | null>(null)
  const [signingIn, setSigningIn] = useState(false)

  // A remembered session is restored once, and a save that cannot be trusted is
  // cleared rather than left to fail later at connect time.
  useEffect(() => {
    let raw: string | null = null
    try {
      raw = localStorage.getItem(STORE_KEY)
    } catch {
      return
    }
    const restored = readStoredSession(raw, Date.now())
    if (restored) setSession(restored)
    else if (raw) {
      try {
        localStorage.removeItem(STORE_KEY)
      } catch {
        /* storage blocked; nothing to clear */
      }
    }
  }, [])

  const signIn = useCallback(async (email: string, password: string, region: string) => {
    setSigningIn(true)
    try {
      const res = await fetch('/api/cloud/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, region }),
      })
      const body = (await res.json()) as { token?: string; robots?: CloudRobot[]; error?: string }
      if (!res.ok || body.error) throw new Error(body.error ?? `HTTP ${res.status}`)

      const next: CloudSession = { token: body.token ?? '', robots: body.robots ?? [] }
      setSession(next)
      // An account with no robots is a real answer, not a session worth keeping.
      if (next.robots.length) {
        try {
          localStorage.setItem(STORE_KEY, storeSession(next, Date.now()))
        } catch {
          /* storage full or blocked; the session just will not survive a reload */
        }
      }
      return next.robots
    } finally {
      setSigningIn(false)
    }
  }, [])

  const signOut = useCallback(() => {
    try {
      localStorage.removeItem(STORE_KEY)
    } catch {
      /* storage blocked; the in-memory session still goes */
    }
    setSession(null)
  }, [])

  return {
    token: session?.token ?? '',
    robots: session?.robots ?? null,
    signingIn,
    signIn,
    signOut,
  }
}

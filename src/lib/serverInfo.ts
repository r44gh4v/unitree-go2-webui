// One shared probe of /api/auth, fetched once per page load.
//
// Both the lock screen and the connection panel need to know what kind of
// server they are talking to, and neither should trigger its own request: the
// promise is created on first use and reused by everyone after that.

export interface ServerInfo {
  /** a password is configured and the gate is active */
  required: boolean
  /** this browser is signed in (or the server is open) */
  authed: boolean
  /** a cloud deployment with no password: the API refuses to serve */
  misconfigured: boolean
}

let pending: Promise<ServerInfo> | null = null

const FALLBACK: ServerInfo = { required: false, authed: true, misconfigured: false }

export function getServerInfo(): Promise<ServerInfo> {
  if (!pending) {
    pending = fetch('/api/auth')
      .then((r) => r.json())
      .then((d: Partial<ServerInfo>) => ({ ...FALLBACK, ...d }))
      // An unreachable server is reported as open so the app still loads and
      // its own connection errors can explain what is wrong.
      .catch(() => FALLBACK)
  }
  return pending
}

/** Re-probe on the next call, after a login or when the window regains focus. */
export function refreshServerInfo(): Promise<ServerInfo> {
  pending = null
  return getServerInfo()
}

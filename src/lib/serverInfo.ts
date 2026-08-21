// What kind of server is on the other end of /api.
//
// Answers three things the interface needs before it can show anything: whether
// a password gate is active, whether this browser is already through it, and
// whether the server is a cloud deployment left without a password (which
// refuses to serve rather than running open).

export interface ServerInfo {
  /** a password is configured and the gate is active */
  required: boolean
  /** this browser is signed in, or the server is open */
  authed: boolean
  /** a cloud deployment with no password: the API refuses to serve */
  misconfigured: boolean
}

// An unreachable server is reported as open so the app still loads and its own
// connection errors can explain what is wrong, rather than trapping the user on
// a lock screen it cannot verify.
const FALLBACK: ServerInfo = { required: false, authed: true, misconfigured: false }

export function probeServer(): Promise<ServerInfo> {
  return fetch('/api/auth')
    .then((r) => r.json())
    .then((d: Partial<ServerInfo>) => ({ ...FALLBACK, ...d }))
    .catch(() => FALLBACK)
}

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { ShieldIcon } from './Icons'

/**
 * Blocks the interface behind a password prompt when the server has one
 * configured (WEBUI_PASSWORD) - the case for a deployment reachable from the
 * internet. A server with no password reports the gate as off and this renders
 * nothing but the app; a cloud deployment with no password refuses to serve and
 * is explained here. The session lives in an HttpOnly cookie set by the server,
 * so there is nothing to store on this side. The check re-runs when the window
 * regains focus, so a session that expired while the tab sat open re-locks
 * instead of dead-ending every call in 401s.
 */
export default function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<'checking' | 'locked' | 'open' | 'misconfigured'>('checking')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const check = useCallback(() => {
    fetch('/api/auth')
      .then((r) => r.json())
      .then((d: { required?: boolean; authed?: boolean; misconfigured?: boolean }) => {
        setState(d.misconfigured ? 'misconfigured' : d.required && !d.authed ? 'locked' : 'open')
      })
      .catch(() => {
        // The server is unreachable; let the app load so its own connection
        // errors can say so, rather than trapping the user on a lock screen.
        setState((s) => (s === 'checking' ? 'open' : s))
      })
  }, [])

  useEffect(() => {
    check()
    window.addEventListener('focus', check)
    return () => window.removeEventListener('focus', check)
  }, [check])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      if (res.ok) {
        setPassword('')
        setState('open')
      } else {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        setError(body.error ?? `Login failed (HTTP ${res.status})`)
      }
    } catch {
      setError('Could not reach the server.')
    } finally {
      setBusy(false)
    }
  }

  if (state === 'open') return <>{children}</>

  return (
    <div className="lock-screen">
      <form className="lock-card" onSubmit={submit}>
        <p className="eyebrow icon-eyebrow">
          <ShieldIcon size={14} /> unitree_go2_webui
        </p>
        {state === 'checking' && <p className="note">Checking access…</p>}
        {state === 'misconfigured' && (
          <p className="note warn">
            This deployment has no password set, so the API refuses to serve. Add a <code>WEBUI_PASSWORD</code>{' '}
            environment variable in the project settings and redeploy.
          </p>
        )}
        {state === 'locked' && (
          <>
            <p className="note">This console is password-protected.</p>
            <input
              className="input"
              type="password"
              autoFocus
              placeholder="Password"
              aria-label="Console password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button className="btn primary block" type="submit" disabled={busy || !password}>
              {busy ? 'Checking…' : 'Enter'}
            </button>
            {error && (
              <p className="note warn" role="alert">
                {error}
              </p>
            )}
          </>
        )}
      </form>
    </div>
  )
}

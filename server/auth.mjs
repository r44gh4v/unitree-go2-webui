// Optional password gate for the API.
//
// With no password configured the LOCAL server behaves as before: open,
// intended for localhost or a trusted LAN. On a serverless deployment - which
// is always internet-facing - the gate is mandatory: with no password set the
// API refuses to serve rather than silently running open, and the interface
// explains what to configure. The static files stay public; they contain
// nothing secret, and the app needs to load to show the lock screen.
//
// Sessions are stateless: the cookie is an expiry timestamp signed with a key
// derived from the password. Nothing is stored server-side, so it works the
// same on a long-running local server and on serverless, where each request may
// land on a fresh instance. Changing the password invalidates every session.

import crypto from 'node:crypto'

const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000
const COOKIE_NAME = 'webui_session'
const VERSION = 'v1'

/** Login attempts allowed per address per window, to slow brute force. */
const ATTEMPT_WINDOW_MS = 60_000
const ATTEMPTS_PER_WINDOW = 10
/** Flat delay on a failed attempt so guessing is slow even inside the budget. */
const FAIL_DELAY_MS = 400

/** address -> [attempt timestamps]. Per-instance, which is the best a
 * stateless deployment can do - the flat delay carries most of the weight. */
const attempts = new Map()

function sha256(s) {
  return crypto.createHash('sha256').update(s, 'utf8').digest()
}

/** Constant-time equality over fixed-length digests, so length leaks nothing. */
function passwordMatches(given, expected) {
  return crypto.timingSafeEqual(sha256(given), sha256(expected))
}

/**
 * Signing key derived from the password with scrypt, so a captured cookie
 * cannot be turned into a fast offline GPU attack on the password - each guess
 * costs a memory-hard derivation. Computed once at startup; rotating the
 * password rotates the key and signs everyone out.
 */
function signingKey(password) {
  return crypto.scryptSync(password, `unitree_go2_webui auth ${VERSION}`, 32, { N: 16384, r: 8, p: 1 })
}

function sign(key, expiry) {
  return crypto.createHmac('sha256', key).update(`${VERSION}.${expiry}`).digest('hex')
}

function makeToken(key) {
  const expiry = Date.now() + SESSION_TTL_MS
  return `${VERSION}.${expiry}.${sign(key, expiry)}`
}

function tokenValid(key, token) {
  const [v, expiryStr, sig] = String(token).split('.')
  if (v !== VERSION || !expiryStr || !sig) return false
  const expiry = Number(expiryStr)
  if (!Number.isFinite(expiry) || Date.now() > expiry) return false
  // No token we issued expires further out than the TTL; anything beyond it
  // (plus a minute of clock skew) is forged, whatever its signature says.
  if (expiry > Date.now() + SESSION_TTL_MS + 60_000) return false
  const want = Buffer.from(sign(key, expiryStr), 'hex')
  let got
  try {
    got = Buffer.from(sig, 'hex')
  } catch {
    return false
  }
  return got.length === want.length && crypto.timingSafeEqual(got, want)
}

function parseCookies(header) {
  const out = {}
  if (!header) return out
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim()
  }
  return out
}

/**
 * The address the rate limit keys on. Locally that is the raw socket peer -
 * never a spoofable header. Behind Vercel's proxy the socket peer is the
 * platform bridge (the same for every visitor, which would collapse the limit
 * into one shared bucket), but there x-forwarded-for is set by the platform
 * itself and its first entry is the real client.
 */
function clientAddr(req) {
  if (process.env.VERCEL === '1') {
    const xff = String(req.headers['x-forwarded-for'] ?? '')
    const first = xff.split(',')[0].trim()
    if (first) return first
  }
  return req.socket.remoteAddress ?? 'unknown'
}

function overAttemptBudget(addr) {
  const now = Date.now()
  const list = (attempts.get(addr) ?? []).filter((t) => now - t < ATTEMPT_WINDOW_MS)
  list.push(now)
  attempts.set(addr, list)
  return list.length > ATTEMPTS_PER_WINDOW
}

/** Secure flag when the request arrived over TLS, directly or via a proxy. */
function wantsSecureCookie(req) {
  return req.secure || req.headers['x-forwarded-proto'] === 'https'
}

/**
 * Install the login endpoints and, when a password is configured, the gate on
 * every other /api route. Must be called before the API routes are registered.
 * With `enforce` (the serverless deployments), a missing password does not fall
 * open: the API refuses to serve and /api/auth reports the misconfiguration so
 * the interface can say exactly what to fix.
 * Returns whether the gate is active.
 */
export function installAuth(app, password, { enforce = false } = {}) {
  const required = typeof password === 'string' && password.length > 0
  const misconfigured = enforce && !required
  const key = required ? signingKey(password) : null
  const authed = (req) => !required || tokenValid(key, parseCookies(req.headers.cookie)[COOKIE_NAME] ?? '')

  // Who am I - lets the interface decide whether to show the lock screen, and
  // whether the server has a LAN at all (a cloud deployment does not, so the
  // client skips local-network checks instead of asking pointlessly).
  app.get('/api/auth', (req, res) => {
    res.json({
      required,
      authed: !misconfigured && authed(req),
      misconfigured,
      serverless: process.env.VERCEL === '1',
    })
  })

  app.post('/api/login', (req, res) => {
    if (misconfigured) {
      res.status(503).json({ error: 'No password is configured - set WEBUI_PASSWORD in the deployment settings' })
      return
    }
    if (!required) {
      res.json({ ok: true })
      return
    }
    const addr = clientAddr(req)
    if (overAttemptBudget(addr)) {
      res.status(429).json({ error: 'Too many attempts - wait a minute and try again' })
      return
    }
    const given = typeof req.body?.password === 'string' ? req.body.password : ''
    if (!passwordMatches(given, password)) {
      setTimeout(() => res.status(401).json({ error: 'Wrong password' }), FAIL_DELAY_MS)
      return
    }
    const flags = ['HttpOnly', 'SameSite=Strict', 'Path=/', `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`]
    if (wantsSecureCookie(req)) flags.push('Secure')
    res.setHeader('Set-Cookie', `${COOKIE_NAME}=${makeToken(key)}; ${flags.join('; ')}`)
    res.json({ ok: true })
  })

  // Stateless tokens cannot be revoked individually; clearing the cookie signs
  // this browser out, and changing the password signs everyone out.
  app.post('/api/logout', (_req, res) => {
    res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`)
    res.json({ ok: true })
  })

  if (misconfigured) {
    // Refuse to serve an unauthenticated API on a public deployment.
    app.use('/api', (_req, res) => {
      res.status(503).json({ error: 'No password is configured - set WEBUI_PASSWORD in the deployment settings' })
    })
  } else if (required) {
    app.use('/api', (req, res, next) => {
      if (authed(req)) {
        next()
        return
      }
      res.status(401).json({ error: 'Sign in to this console first' })
    })
  }

  return required
}

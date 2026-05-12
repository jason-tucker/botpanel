/**
 * CSRF protection — double-submit cookie pattern.
 *
 * The server issues a random token via `GET /api/csrf`, sets it as a
 * non-HttpOnly cookie (`__Host-csrf`), and ALSO returns it in the JSON
 * body. The client reads the cookie or the body and echoes the value
 * back on every state-changing request — either in the `x-csrf-token`
 * header (XHR/fetch) or the `_csrf` form field (classic form posts).
 *
 * The header/form value must match the cookie value byte-for-byte
 * (constant-time compare). An attacker on a different origin can plant
 * a cookie in their own request to us, but they can't read OUR cookie
 * from a victim's browser thanks to same-origin policy + SameSite=Lax,
 * so they cannot also produce the matching header — which is the
 * whole point of double-submit. HttpOnly is intentionally OFF on the
 * CSRF cookie so the client JS can read it; the session cookie that
 * actually grants auth stays HttpOnly.
 *
 * For MVP we don't bind the token to a session — that's a "session-
 * fixation defense" upgrade for V2.5 once we have a server-side
 * session store to anchor against.
 */
import { cookies } from 'next/headers'
import { timingSafeEqual, randomBytes } from 'node:crypto'
import type { NextRequest } from 'next/server'

export const CSRF_COOKIE = '__Host-csrf'
export const CSRF_HEADER = 'x-csrf-token'
export const CSRF_FORM_FIELD = '_csrf'

const TTL_SECONDS = 60 * 60 * 8 // 8h — refreshed on every GET /api/csrf

/**
 * Generate a fresh token and write the `__Host-csrf` cookie. Returns
 * the raw token so the caller can also embed it in the JSON response
 * body (the client uses whichever it can read).
 */
export async function issueCsrfToken(): Promise<string> {
  const token = randomBytes(32).toString('hex')
  const c = await cookies()
  c.set(CSRF_COOKIE, token, {
    // MUST be readable by client JS for the double-submit pattern.
    httpOnly: false,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: TTL_SECONDS,
  })
  return token
}

/**
 * Constant-time string equality. Returns false fast when lengths
 * differ — that's not a meaningful timing leak because the lengths
 * here are fixed (64 hex chars for our tokens) so any real attempt
 * matches the expected size.
 */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  try {
    const ab = Buffer.from(a, 'utf8')
    const bb = Buffer.from(b, 'utf8')
    if (ab.length !== bb.length) return false
    return timingSafeEqual(ab, bb)
  } catch {
    return false
  }
}

/**
 * Validate a request's CSRF token. Reads the `__Host-csrf` cookie
 * directly off `req` (NOT the next/headers cookies(), which doesn't
 * see request-scoped cookies inside route handlers reliably under
 * every Next runtime — using `req.cookies` is the canonical path).
 * Compares against the `x-csrf-token` header first; falls back to
 * the `_csrf` form field for non-JS form submits.
 *
 * Async because we may need to read a form body to find the field.
 */
export async function verifyCsrfToken(req: NextRequest): Promise<boolean> {
  const cookieToken = req.cookies.get(CSRF_COOKIE)?.value
  if (!cookieToken) return false

  const headerToken = req.headers.get(CSRF_HEADER)
  if (headerToken && safeEqual(headerToken, cookieToken)) return true

  // Form-field fallback. We have to be careful: reading the body
  // here consumes it, so the route handler can't read it again.
  // We only fall back when the request looks like a form post AND
  // no header token was supplied — JSON callers should always
  // prefer the header path so their body stays intact.
  const ct = req.headers.get('content-type') ?? ''
  if (!ct.includes('application/x-www-form-urlencoded') && !ct.includes('multipart/form-data')) {
    return false
  }
  try {
    // .clone() so the caller can still read the body. Next's
    // NextRequest supports .clone() in route handlers on Node runtime.
    const cloned = req.clone()
    const form = await cloned.formData()
    const formToken = form.get(CSRF_FORM_FIELD)
    if (typeof formToken === 'string' && safeEqual(formToken, cookieToken)) {
      return true
    }
  } catch {
    // Body unreadable / malformed — treat as failure.
    return false
  }
  return false
}

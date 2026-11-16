import { NextResponse } from 'next/server'
import { clearSessionCookie, forgetSession, readSessionClaims, revokeSession } from '@/lib/auth/session'
import { expectedOriginFrom, isSameOriginRequest } from '@/lib/auth/sameOrigin'
import { writeAudit } from '@/lib/audit'
import { env } from '@/lib/env'

export const dynamic = 'force-dynamic'

/**
 * POST /api/auth/logout — plain HTML form POST (works without JS), so it
 * can't carry the double-submit CSRF token. A cross-site form could
 * otherwise force a logout, so the request must come from our own origin
 * (Origin header, or Sec-Fetch-Site: same-origin when Origin is absent).
 *
 * Deletes the session's `panel_sessions` row so the session is revoked
 * server-side, not just in this browser, then clears the cookie.
 */
export async function POST(req: Request) {
  // Behind Caddy `req.url` carries the internal origin (next:3000), so the
  // public origin comes from PUBLIC_BASE_URL. The request origin is only a
  // fallback for local dev where the env var is unset.
  const expectedOrigin = expectedOriginFrom(env.PUBLIC_BASE_URL, req.url)
  if (!isSameOriginRequest(req.headers, expectedOrigin)) {
    return NextResponse.json({ error: 'csrf' }, { status: 403 })
  }

  // Signature + expiry only: a session that is already revoked (or whose
  // store is down) still needs its row removed and its cookie cleared.
  const claims = await readSessionClaims()
  let rowDelete: 'deleted' | 'failed' | 'timeout' | 'skipped' = 'skipped'
  if (claims?.jti) {
    if (env.SQUISHY_DATABASE_URL) {
      try {
        // Bounded: a locked row or slow DB must not hold up the cookie clear.
        const { deleteSessionRowBounded, dbErrorText, retrySessionRowDeleteLater } = await import(
          '@/lib/db/panelSessions'
        )
        const r = await deleteSessionRowBounded(claims.jti)
        if (r.ok) {
          rowDelete = 'deleted'
        } else {
          rowDelete = r.reason
          // Not the error itself: Drizzle's message carries the params (the jti).
          console.warn(
            '[auth.logout] session row delete',
            r.reason === 'timeout' ? 'timed out' : `failed: ${dbErrorText(r.error)}`,
            '(non-fatal; retrying once in 5 s)',
          )
          retrySessionRowDeleteLater(claims.jti)
        }
      } catch {
        rowDelete = 'failed'
        console.warn('[auth.logout] session row delete could not start (non-fatal)')
      }
    }
    if (rowDelete === 'deleted' || rowDelete === 'skipped') {
      // Row gone (or no store): drop the cached verdict; the next check asks
      // the store, which no longer has the row.
      forgetSession(claims.jti)
    } else {
      // Row may survive: this process answers 'revoked' for the jti until the
      // JWT expires, whatever a lookup finds. Any other `next` process still
      // honours the session while the row exists, plus up to its 30 s verdict
      // cache after the 5 s background retry (or anything else) deletes it;
      // if the retry fails too, until the JWT expires. docker-compose.yml runs
      // a single `next` service, so normally there is no other process.
      revokeSession(claims.jti, (claims as { exp?: number }).exp)
    }
  }

  await clearSessionCookie()

  if (claims) {
    const actor = { id: claims.id, username: claims.username }
    // writeAudit is bounded: auth.logout goes through insertPanelAudit
    // (800 ms DB-side timeouts, 1 s caller-side cap) and never throws.
    await writeAudit({
      bot: 'squishy',
      actor,
      viewing: actor,
      action: 'auth.logout',
      targetType: 'panel_sessions',
      targetId: null,
      // Cookie is always cleared; success means the row is gone too.
      success: rowDelete === 'deleted' || rowDelete === 'skipped',
      after: { rowDelete },
    })
  }

  return NextResponse.redirect(new URL('/', expectedOrigin), 303)
}

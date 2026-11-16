import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { clearSessionCookie, forgetSession, readSessionClaims } from '@/lib/auth/session'
import { expectedOriginFrom, isSameOriginRequest } from '@/lib/auth/sameOrigin'
import { sessions as panelSessions } from '@/lib/db/schema/panel'
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
  if (claims?.jti) {
    if (env.SQUISHY_DATABASE_URL) {
      try {
        const { squishyDb } = await import('@/lib/db/squishy')
        await squishyDb.delete(panelSessions).where(eq(panelSessions.id, claims.jti))
      } catch (err) {
        // Not `err` itself: Drizzle's message carries the params (the jti).
        const { dbErrorText } = await import('@/lib/db/panelSessions')
        console.warn('[auth.logout] failed to delete the session row (non-fatal):', dbErrorText(err))
      }
    }
    forgetSession(claims.jti)
  }

  await clearSessionCookie()

  if (claims) {
    const actor = { id: claims.id, username: claims.username }
    await writeAudit({
      bot: 'squishy',
      actor,
      viewing: actor,
      action: 'auth.logout',
      targetType: 'panel_sessions',
      targetId: null,
      success: true,
    })
  }

  return NextResponse.redirect(new URL('/', expectedOrigin), 303)
}

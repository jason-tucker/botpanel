/**
 * POST /api/admin/auth/logout-all — bot-owner-only "kick everyone but me"
 * for security-incident response (e.g. operator just rotated
 * `OAUTH_TOKEN_KEY`, or suspects an unauthorized session).
 *
 * Deletes every row in `panel_sessions` whose id is NOT the actor's own
 * JWT jti, so the operator triggering the action doesn't immediately
 * log themselves out of the page they're using to trigger it. Returns
 * the count of rows deleted.
 *
 * Caveat: the JWT cookie itself is stateless — a logged-in user whose
 * `panel_sessions` row was deleted still has a valid cookie until the
 * 3-day TTL expires. The follow-up V3-3.5 issue adds a "session must
 * match a live `panel_sessions` row" check to the resolver so this
 * route really does end every other session immediately. For V3-3
 * the practical effect is just "their refresh token is gone, so they
 * can't silently renew" — combined with the JWT TTL the blast radius
 * is bounded at 3 days.
 *
 * Rate-limited at 1/hour because the only legitimate use is incident
 * response — anything more frequent is almost certainly a mis-fire.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { ne } from 'drizzle-orm'
import { withAuth } from '@/lib/auth/middleware'
import { getSession } from '@/lib/auth/session'
import { sessions as panelSessions } from '@/lib/db/schema/panel'
import { writeAudit } from '@/lib/audit'
import { env } from '@/lib/env'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = withAuth(
  async (_req: NextRequest, access) => {
    // The JWT carries the actor's own session id (jti). We need this to
    // exclude their row from the truncate so they stay logged in. If a
    // legacy JWT has no jti, we still proceed — every row gets deleted,
    // including any theoretical row for this user, and the operator
    // re-logs.
    const session = await getSession()
    const actorJti = session?.jti ?? null

    if (!env.SQUISHY_DATABASE_URL) {
      return NextResponse.json(
        { error: 'panel_sessions DB not configured' },
        { status: 503 },
      )
    }

    let deleted = 0
    try {
      const { squishyDb } = await import('@/lib/db/squishy')
      // When the actor has a jti, exclude their row from the wipe;
      // otherwise (legacy JWTs) just nuke everything — they'll re-OAuth.
      const q = actorJti
        ? squishyDb.delete(panelSessions).where(ne(panelSessions.id, actorJti))
        : squishyDb.delete(panelSessions)
      const rows = await q.returning({ id: panelSessions.id })
      deleted = rows.length
    } catch (err) {
      console.error('[logout-all] delete failed', err)
      return NextResponse.json(
        { error: 'delete_failed' },
        { status: 500 },
      )
    }

    await writeAudit({
      bot: 'squishy',
      actor: access.actor,
      viewing: access.viewing,
      action: 'auth.logout_all',
      targetType: 'panel_sessions',
      targetId: null,
      before: null,
      // Per V3-3 spec: count of rows deleted in `after`.
      after: { deletedCount: deleted, preservedJti: actorJti },
      success: true,
    })

    return NextResponse.json({ ok: true, deleted })
  },
  {
    require: 'botOwner',
    csrf: true,
    // 1/hour — only legitimate use is incident response. Hard cap blocks
    // a stuck UI button from accidentally truncating sessions on repeat.
    rateLimit: { points: 1, perSeconds: 3600 },
  },
)

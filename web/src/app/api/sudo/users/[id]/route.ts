/**
 * DELETE /api/sudo/users/[id] — revoke a DB-source sudo grant.
 *
 * Gate: bot owner only. CSRF on; rate-limited 10/min/actor — same envelope
 * as POST since grant + revoke are paired actions.
 *
 * Important: this **only** affects the `sudo_users` row. Env-source grants
 * (`SUDO_USER_IDS`) are operator-only and have to be removed by editing
 * `.env` and redeploying. The `/sudo` page surfaces both sources via pills
 * so an owner knows when a "revoke" click is incomplete.
 *
 * Idempotent: deleting a row that doesn't exist returns
 * `{ ok:true, revoked:false }` so the UI can refresh without a popup.
 *
 * Audit: every success and every failure writes `sudo.revoked` via
 * `writeAudit`. `before` is the row we just removed; `after` is null.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { withAuth } from '@/lib/auth/middleware'
import { writeAudit } from '@/lib/audit'
import { squishyDb, squishySchema } from '@/lib/db/squishy'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SNOWFLAKE_RE = /^\d{15,25}$/

type RouteCtx = { params: Promise<{ id: string }> }

export const DELETE = withAuth(
  async (_req: NextRequest, access, ctx: RouteCtx) => {
    const { id } = await ctx.params
    const actor = access.actor.id

    if (!SNOWFLAKE_RE.test(id)) {
      await writeAudit({
        bot: 'squishy',
        action: 'sudo.revoked',
        targetType: 'sudo_users',
        targetId: id,
        actorDiscordId: actor,
        before: null,
        after: null,
        ok: false,
        error: 'invalid-snowflake',
      }).catch(() => {})
      return NextResponse.json(
        { error: 'id must be a Discord snowflake (15-25 digits)' },
        { status: 400 },
      )
    }

    let before:
      | { userId: string; addedByDiscordId: string | null; note: string | null }
      | null = null
    try {
      const rows = await squishyDb
        .select({
          userId: squishySchema.sudoUsers.userId,
          addedByDiscordId: squishySchema.sudoUsers.addedByDiscordId,
          note: squishySchema.sudoUsers.note,
        })
        .from(squishySchema.sudoUsers)
        .where(eq(squishySchema.sudoUsers.userId, id))
        .limit(1)
      before = rows[0] ?? null
    } catch (err) {
      console.warn('[sudo/users DELETE] read-before-delete failed', err)
    }

    if (before === null) {
      await writeAudit({
        bot: 'squishy',
        action: 'sudo.revoked',
        targetType: 'sudo_users',
        targetId: id,
        actorDiscordId: actor,
        before: null,
        after: null,
        ok: true,
        error: 'not-found',
      }).catch(() => {})
      return NextResponse.json({ ok: true, userId: id, revoked: false })
    }

    try {
      await squishyDb
        .delete(squishySchema.sudoUsers)
        .where(eq(squishySchema.sudoUsers.userId, id))
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown'
      console.error('[sudo/users DELETE] DB write failed', err)
      await writeAudit({
        bot: 'squishy',
        action: 'sudo.revoked',
        targetType: 'sudo_users',
        targetId: id,
        actorDiscordId: actor,
        before,
        after: null,
        ok: false,
        error: msg,
      }).catch(() => {})
      return NextResponse.json({ error: 'db-write-failed' }, { status: 503 })
    }

    await writeAudit({
      bot: 'squishy',
      action: 'sudo.revoked',
      targetType: 'sudo_users',
      targetId: id,
      actorDiscordId: actor,
      before,
      after: null,
      ok: true,
    }).catch((err) => {
      console.warn('[sudo/users DELETE] audit write failed (delete succeeded)', err)
    })

    return NextResponse.json({ ok: true, userId: id, revoked: true })
  },
  {
    require: 'botOwner',
    csrf: true,
    rateLimit: { points: 10, perSeconds: 60 },
  },
)

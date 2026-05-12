/**
 * DELETE /api/squishy/auto-join-roles/[id] — remove a role from the
 * auto-join list. `[id]` is the Discord role snowflake (the PK).
 *
 * Sudo-gated; CSRF + 30/min rate limit handled by `withAuth`. Audit
 * on success AND failure.
 *
 * 404 vs 200: if the role wasn't in the table we return 404 — the
 * route is idempotent in the sense that the DB ends up the same
 * regardless, but the caller probably wants to know the click didn't
 * actually delete anything (typo, concurrent removal, etc.).
 */
import { NextResponse, type NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { withAuth } from '@/lib/auth/middleware'
import { writeAudit } from '@/lib/audit'
import { squishyDb, squishySchema } from '@/lib/db/squishy'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SNOWFLAKE_RE = /^\d{15,25}$/

export const DELETE = withAuth(
  async (
    _req: NextRequest,
    access,
    ctx: { params: Promise<{ id: string }> },
  ) => {
    const { id } = await ctx.params
    const roleId = (id ?? '').trim()
    if (!SNOWFLAKE_RE.test(roleId)) {
      await writeAudit({
        bot: 'squishy',
        action: 'auto_join_role.removed',
        actor: access.actor,
        viewing: access.viewing,
        targetType: 'auto_join_roles',
        targetId: roleId,
        success: false,
        errorMessage: 'invalid-snowflake',
      }).catch(() => {})
      return NextResponse.json(
        { error: 'id must be a Discord snowflake (15-25 digits)' },
        { status: 400 },
      )
    }

    try {
      const removed = await squishyDb
        .delete(squishySchema.autoJoinRoles)
        .where(eq(squishySchema.autoJoinRoles.roleId, roleId))
        .returning()
      if (removed.length === 0) {
        await writeAudit({
          bot: 'squishy',
          action: 'auto_join_role.removed',
          actor: access.actor,
          viewing: access.viewing,
          targetType: 'auto_join_roles',
          targetId: roleId,
          success: false,
          errorMessage: 'not-found',
        }).catch(() => {})
        return NextResponse.json({ error: 'not found' }, { status: 404 })
      }

      await writeAudit({
        bot: 'squishy',
        action: 'auto_join_role.removed',
        actor: access.actor,
        viewing: access.viewing,
        targetType: 'auto_join_roles',
        targetId: roleId,
        before: removed[0],
        after: null,
        success: true,
      }).catch((err) => {
        console.warn('[auto-join-roles DELETE] audit write failed', err)
      })
      return NextResponse.json({ ok: true, roleId })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown'
      console.error('[auto-join-roles DELETE] db delete failed', err)
      await writeAudit({
        bot: 'squishy',
        action: 'auto_join_role.removed',
        actor: access.actor,
        viewing: access.viewing,
        targetType: 'auto_join_roles',
        targetId: roleId,
        success: false,
        errorMessage: msg,
      }).catch(() => {})
      return NextResponse.json({ error: 'db-write-failed' }, { status: 503 })
    }
  },
  {
    require: 'sudo',
    csrf: true,
    rateLimit: { points: 30, perSeconds: 60 },
  },
)

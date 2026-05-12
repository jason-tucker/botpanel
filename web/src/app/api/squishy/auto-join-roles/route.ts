/**
 * POST /api/squishy/auto-join-roles — add a role to the auto-join list.
 *
 * Body: `{ roleId: string }`. The bot reads this table on every
 * `guildMemberAdd` (when `feature.auto_role_on_join` is on), so the
 * write takes effect immediately — no cache invalidation needed.
 *
 * Conflict policy: `ON CONFLICT(role_id) DO NOTHING` — re-adding an
 * existing row returns `{ ok:true, created:false }` rather than 409'ing.
 * The audit row still lands so the trail records the intent.
 *
 * Gating: sudo via `withAuth({require:'sudo'})`. CSRF and 30/min rate
 * limit handled by the wrapper. Schema gotcha: `auto_join_roles.guildId`
 * is NOT NULL — we refuse with `GUILD_ID_unset` (500) when the panel
 * env doesn't pin a guild.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { withAuth } from '@/lib/auth/middleware'
import { writeAudit } from '@/lib/audit'
import { squishyDb, squishySchema } from '@/lib/db/squishy'
import { env } from '@/lib/env'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SNOWFLAKE_RE = /^\d{15,25}$/

export const POST = withAuth(
  async (req: NextRequest, access) => {
    let body: unknown
    try {
      body = await req.json()
    } catch {
      await writeAudit({
        bot: 'squishy',
        action: 'auto_join_role.added',
        actor: access.actor,
        viewing: access.viewing,
        targetType: 'auto_join_roles',
        success: false,
        errorMessage: 'invalid-json',
      }).catch(() => {})
      return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
    }

    const raw = (body as { roleId?: unknown } | null)?.roleId
    const roleId = typeof raw === 'string' ? raw.trim() : ''
    if (!SNOWFLAKE_RE.test(roleId)) {
      await writeAudit({
        bot: 'squishy',
        action: 'auto_join_role.added',
        actor: access.actor,
        viewing: access.viewing,
        targetType: 'auto_join_roles',
        targetId: roleId,
        success: false,
        errorMessage: 'invalid-snowflake',
      }).catch(() => {})
      return NextResponse.json(
        { error: 'roleId must be a Discord snowflake (15-25 digits)' },
        { status: 400 },
      )
    }

    if (!env.GUILD_ID) {
      await writeAudit({
        bot: 'squishy',
        action: 'auto_join_role.added',
        actor: access.actor,
        viewing: access.viewing,
        targetType: 'auto_join_roles',
        targetId: roleId,
        success: false,
        errorMessage: 'GUILD_ID-unset',
      }).catch(() => {})
      return NextResponse.json({ error: 'GUILD_ID is not configured' }, { status: 500 })
    }

    try {
      const inserted = await squishyDb
        .insert(squishySchema.autoJoinRoles)
        .values({
          roleId,
          guildId: env.GUILD_ID,
          addedByUserId: access.actor.id,
        })
        .onConflictDoNothing({ target: squishySchema.autoJoinRoles.roleId })
        .returning()

      const created = inserted.length > 0
      await writeAudit({
        bot: 'squishy',
        action: 'auto_join_role.added',
        actor: access.actor,
        viewing: access.viewing,
        targetType: 'auto_join_roles',
        targetId: roleId,
        before: null,
        after: created ? inserted[0] : { roleId, alreadyPresent: true },
        success: true,
      }).catch((err) => {
        console.warn('[auto-join-roles POST] audit write failed', err)
      })
      return NextResponse.json(
        { ok: true, roleId, created },
        { status: created ? 201 : 200 },
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown'
      console.error('[auto-join-roles POST] db write failed', err)
      await writeAudit({
        bot: 'squishy',
        action: 'auto_join_role.added',
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

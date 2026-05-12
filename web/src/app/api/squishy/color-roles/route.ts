/**
 * POST /api/squishy/color-roles — curate a color role (insert OR update).
 *
 * Body: `{ roleId: string, label?: string, sortOrder?: number }`.
 *
 * Conflict policy: re-posting the same `roleId` with a new label /
 * sortOrder edits in place rather than 409'ing. Implemented as a
 * SELECT-then-INSERT-or-UPDATE branch (not a single ON CONFLICT) so
 * we (a) only patch the columns the caller actually sent — a POST
 * with just `{ roleId, label }` won't wipe an existing `sortOrder` —
 * and (b) get a clean before/after snapshot for the audit row.
 *
 * Schema gotchas:
 *  - `color_roles.label` is NOT NULL — when callers omit `label` on
 *    INSERT we fall back to the role ID itself. Discord stores the
 *    actual hex on the role, so we don't store color here.
 *  - `color_roles.guildId` is NOT NULL — refuse with `GUILD_ID_unset`
 *    when the panel env doesn't pin a guild.
 *
 * Audit action: `color_role.added` for fresh inserts, `color_role.updated`
 * for the update branch — the unified audit tail filters by action.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { withAuth } from '@/lib/auth/middleware'
import { writeAudit } from '@/lib/audit'
import { squishyDb, squishySchema } from '@/lib/db/squishy'
import { env } from '@/lib/env'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SNOWFLAKE_RE = /^\d{15,25}$/
const MAX_LABEL_LEN = 100

export const POST = withAuth(
  async (req: NextRequest, access) => {
    let body: { roleId?: unknown; label?: unknown; sortOrder?: unknown }
    try {
      body = (await req.json()) ?? {}
    } catch {
      await writeAudit({
        bot: 'squishy',
        action: 'color_role.added',
        actor: access.actor,
        viewing: access.viewing,
        targetType: 'color_roles',
        success: false,
        errorMessage: 'invalid-json',
      }).catch(() => {})
      return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
    }

    const rawId = typeof body.roleId === 'string' ? body.roleId.trim() : ''
    if (!SNOWFLAKE_RE.test(rawId)) {
      await writeAudit({
        bot: 'squishy',
        action: 'color_role.added',
        actor: access.actor,
        viewing: access.viewing,
        targetType: 'color_roles',
        targetId: rawId,
        success: false,
        errorMessage: 'invalid-snowflake',
      }).catch(() => {})
      return NextResponse.json(
        { error: 'roleId must be a Discord snowflake (15-25 digits)' },
        { status: 400 },
      )
    }
    const roleId = rawId

    let label: string | null = null
    if (body.label !== undefined && body.label !== null) {
      if (typeof body.label !== 'string') {
        return NextResponse.json(
          { error: 'label must be a string' },
          { status: 400 },
        )
      }
      const trimmed = body.label.trim()
      if (trimmed.length > MAX_LABEL_LEN) {
        return NextResponse.json(
          { error: `label too long (max ${MAX_LABEL_LEN})` },
          { status: 400 },
        )
      }
      if (trimmed.length > 0) label = trimmed
    }

    let sortOrder: number | null = null
    if (body.sortOrder !== undefined && body.sortOrder !== null) {
      if (
        typeof body.sortOrder !== 'number' ||
        !Number.isFinite(body.sortOrder) ||
        !Number.isInteger(body.sortOrder)
      ) {
        return NextResponse.json(
          { error: 'sortOrder must be an integer' },
          { status: 400 },
        )
      }
      sortOrder = body.sortOrder
    }

    if (!env.GUILD_ID) {
      await writeAudit({
        bot: 'squishy',
        action: 'color_role.added',
        actor: access.actor,
        viewing: access.viewing,
        targetType: 'color_roles',
        targetId: roleId,
        success: false,
        errorMessage: 'GUILD_ID-unset',
      }).catch(() => {})
      return NextResponse.json(
        { error: 'GUILD_ID is not configured' },
        { status: 500 },
      )
    }

    try {
      // SELECT first so we can branch insert vs update and feed the
      // audit row a clean before/after.
      const existing = await squishyDb
        .select()
        .from(squishySchema.colorRoles)
        .where(eq(squishySchema.colorRoles.roleId, roleId))

      if (existing.length > 0) {
        // Update path — only patch the fields the caller actually sent.
        const patch: { label?: string; sortOrder?: number } = {}
        if (label !== null) patch.label = label
        if (sortOrder !== null) patch.sortOrder = sortOrder
        let updatedRow = existing[0]
        if (Object.keys(patch).length > 0) {
          const updated = await squishyDb
            .update(squishySchema.colorRoles)
            .set(patch)
            .where(eq(squishySchema.colorRoles.roleId, roleId))
            .returning()
          updatedRow = updated[0] ?? updatedRow
        }
        await writeAudit({
          bot: 'squishy',
          action: 'color_role.updated',
          actor: access.actor,
          viewing: access.viewing,
          targetType: 'color_roles',
          targetId: roleId,
          before: existing[0],
          after: updatedRow,
          success: true,
        }).catch((err) => {
          console.warn('[color-roles POST] audit write failed', err)
        })
        return NextResponse.json(
          { ok: true, roleId, action: 'color_role.updated' },
          { status: 200 },
        )
      }

      // Insert path. NOT-NULL label falls back to roleId; default
      // sortOrder = 0 mirrors the schema default but we set it
      // explicitly so the audit `after` blob is honest.
      const inserted = await squishyDb
        .insert(squishySchema.colorRoles)
        .values({
          roleId,
          guildId: env.GUILD_ID,
          label: label ?? roleId,
          sortOrder: sortOrder ?? 0,
        })
        .returning()
      await writeAudit({
        bot: 'squishy',
        action: 'color_role.added',
        actor: access.actor,
        viewing: access.viewing,
        targetType: 'color_roles',
        targetId: roleId,
        before: null,
        after: inserted[0],
        success: true,
      }).catch((err) => {
        console.warn('[color-roles POST] audit write failed', err)
      })
      return NextResponse.json(
        { ok: true, roleId, action: 'color_role.added' },
        { status: 201 },
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown'
      console.error('[color-roles POST] db write failed', err)
      await writeAudit({
        bot: 'squishy',
        action: 'color_role.added',
        actor: access.actor,
        viewing: access.viewing,
        targetType: 'color_roles',
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

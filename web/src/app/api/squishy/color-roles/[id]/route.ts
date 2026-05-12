/**
 * `/api/squishy/color-roles/[id]` — per-row edit/remove.
 *
 *  - PATCH `{ label?, sortOrder? }` — partial update. 400 if neither
 *    field is present (caller probably meant DELETE); 404 if the row
 *    doesn't exist.
 *  - DELETE — drop the row. 404 if not found, mirroring the auto-join
 *    delete route.
 *
 * Sudo-gated; CSRF + 30/min rate limit handled by `withAuth`. Audit
 * on success AND failure.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { withAuth } from '@/lib/auth/middleware'
import { writeAudit } from '@/lib/audit'
import { squishyDb, squishySchema } from '@/lib/db/squishy'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SNOWFLAKE_RE = /^\d{15,25}$/
const MAX_LABEL_LEN = 100

export const PATCH = withAuth(
  async (
    req: NextRequest,
    access,
    ctx: { params: Promise<{ id: string }> },
  ) => {
    const { id } = await ctx.params
    const roleId = (id ?? '').trim()
    if (!SNOWFLAKE_RE.test(roleId)) {
      await writeAudit({
        bot: 'squishy',
        action: 'color_role.updated',
        actor: access.actor,
        viewing: access.viewing,
        targetType: 'color_roles',
        targetId: roleId,
        success: false,
        errorMessage: 'invalid-snowflake',
      }).catch(() => {})
      return NextResponse.json(
        { error: 'id must be a Discord snowflake (15-25 digits)' },
        { status: 400 },
      )
    }

    let body: { label?: unknown; sortOrder?: unknown }
    try {
      body = (await req.json()) ?? {}
    } catch {
      return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
    }

    const patch: { label?: string; sortOrder?: number } = {}
    if (body.label !== undefined && body.label !== null) {
      if (typeof body.label !== 'string') {
        return NextResponse.json(
          { error: 'label must be a string' },
          { status: 400 },
        )
      }
      const trimmed = body.label.trim()
      if (trimmed.length === 0 || trimmed.length > MAX_LABEL_LEN) {
        return NextResponse.json(
          { error: `label must be 1-${MAX_LABEL_LEN} chars` },
          { status: 400 },
        )
      }
      patch.label = trimmed
    }
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
      patch.sortOrder = body.sortOrder
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json(
        { error: 'no fields to patch — supply label and/or sortOrder' },
        { status: 400 },
      )
    }

    try {
      const existing = await squishyDb
        .select()
        .from(squishySchema.colorRoles)
        .where(eq(squishySchema.colorRoles.roleId, roleId))
      if (existing.length === 0) {
        await writeAudit({
          bot: 'squishy',
          action: 'color_role.updated',
          actor: access.actor,
          viewing: access.viewing,
          targetType: 'color_roles',
          targetId: roleId,
          success: false,
          errorMessage: 'not-found',
        }).catch(() => {})
        return NextResponse.json({ error: 'not found' }, { status: 404 })
      }

      const updated = await squishyDb
        .update(squishySchema.colorRoles)
        .set(patch)
        .where(eq(squishySchema.colorRoles.roleId, roleId))
        .returning()

      await writeAudit({
        bot: 'squishy',
        action: 'color_role.updated',
        actor: access.actor,
        viewing: access.viewing,
        targetType: 'color_roles',
        targetId: roleId,
        before: existing[0],
        after: updated[0],
        success: true,
      }).catch((err) => {
        console.warn('[color-roles PATCH] audit write failed', err)
      })
      return NextResponse.json({ ok: true, roleId, row: updated[0] })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown'
      console.error('[color-roles PATCH] db write failed', err)
      await writeAudit({
        bot: 'squishy',
        action: 'color_role.updated',
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
        action: 'color_role.removed',
        actor: access.actor,
        viewing: access.viewing,
        targetType: 'color_roles',
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
        .delete(squishySchema.colorRoles)
        .where(eq(squishySchema.colorRoles.roleId, roleId))
        .returning()
      if (removed.length === 0) {
        await writeAudit({
          bot: 'squishy',
          action: 'color_role.removed',
          actor: access.actor,
          viewing: access.viewing,
          targetType: 'color_roles',
          targetId: roleId,
          success: false,
          errorMessage: 'not-found',
        }).catch(() => {})
        return NextResponse.json({ error: 'not found' }, { status: 404 })
      }
      await writeAudit({
        bot: 'squishy',
        action: 'color_role.removed',
        actor: access.actor,
        viewing: access.viewing,
        targetType: 'color_roles',
        targetId: roleId,
        before: removed[0],
        after: null,
        success: true,
      }).catch((err) => {
        console.warn('[color-roles DELETE] audit write failed', err)
      })
      return NextResponse.json({ ok: true, roleId })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown'
      console.error('[color-roles DELETE] db delete failed', err)
      await writeAudit({
        bot: 'squishy',
        action: 'color_role.removed',
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

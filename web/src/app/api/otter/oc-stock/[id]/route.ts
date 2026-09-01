/**
 * PATCH /api/otter/oc-stock/[id] — partial update of one stock item.
 * DELETE /api/otter/oc-stock/[id] — drop the row entirely.
 *
 * Both gated on the **configurable** OC-stock edit rule inside the handler
 * — `withAuth({ require: 'any' })` only enforces "logged in"; the
 * capability check (`resolveOcStockAccess().canEdit`, see
 * `@/lib/otter/ocStockAccess`) is the same one the page uses to render its
 * edit affordances. The rule set lives on the `original-clothing` business
 * row and defaults to manager-or-owner, which is what these routes used to
 * hard-code. Every write reads the row BEFORE mutating so the audit log
 * captures both `before` and `after` states (lets Otterbot's `/audit` slash
 * command surface a real diff). CSRF token verified by `withAuth({ csrf:
 * true })`. If the audit write itself fails we swallow that error and keep
 * the user-facing response intact — losing an audit row is bad but it's
 * never bad enough to roll back the underlying write the user already
 * confirmed.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { withAuth } from '@/lib/auth/middleware'
import { writeAudit } from '@/lib/audit'
import { otterDb } from '@/lib/db/otter'
import { ocStock } from '@/lib/db/schema/otter/ocStock'
import { resolveOcStockAccess } from '@/lib/otter/ocStockAccess'
import type { OcStockItem } from '../route'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const STATUS_VALUES = ['in_stock', 'low_stock', 'out_of_stock'] as const

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    status: z.enum(STATUS_VALUES).optional(),
    sortOrder: z.number().int().optional(),
    // Accept "" to mean "clear the URL".
    url: z
      .union([z.literal(''), z.string().trim().max(2048).url()])
      .optional()
      .transform((v) => (v === '' ? null : v)),
  })
  .refine(
    (v) =>
      v.name !== undefined ||
      v.status !== undefined ||
      v.sortOrder !== undefined ||
      v.url !== undefined,
    { message: 'at least one field is required' },
  )

function rowToItem(r: typeof ocStock.$inferSelect): OcStockItem {
  return {
    id: r.id,
    name: r.name,
    status: r.status,
    sortOrder: r.sortOrder,
    url: r.url,
    updatedAt: r.updatedAt.toISOString(),
    updatedByDiscordId: r.updatedByDiscordId,
  }
}

type RouteCtx = { params: Promise<{ id: string }> }

export const PATCH = withAuth<[RouteCtx]>(
  async (req, access, ctx) => {
    if (!(await resolveOcStockAccess(access)).canEdit) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }

    const { id } = await ctx.params
    if (!id) return NextResponse.json({ error: 'invalid id' }, { status: 400 })

    let parsed: z.infer<typeof patchSchema>
    try {
      const body = (await req.json()) as unknown
      parsed = patchSchema.parse(body)
    } catch (err) {
      const details = err instanceof z.ZodError ? err.issues : 'invalid body'
      return NextResponse.json({ error: 'invalid', details }, { status: 400 })
    }

    let before: OcStockItem | null = null
    try {
      const [existing] = await otterDb
        .select()
        .from(ocStock)
        .where(eq(ocStock.id, id))
        .limit(1)
      if (!existing) {
        return NextResponse.json({ error: 'not-found' }, { status: 404 })
      }
      before = rowToItem(existing)

      const patch: Partial<typeof ocStock.$inferInsert> = {
        updatedAt: new Date(),
        updatedByDiscordId: access.viewing.id,
      }
      if (parsed.name !== undefined) patch.name = parsed.name
      if (parsed.status !== undefined) patch.status = parsed.status
      if (parsed.sortOrder !== undefined) patch.sortOrder = parsed.sortOrder
      if (parsed.url !== undefined) patch.url = parsed.url

      const [updated] = await otterDb
        .update(ocStock)
        .set(patch)
        .where(eq(ocStock.id, id))
        .returning()

      const after = rowToItem(updated)

      await writeAudit({
        bot: 'otter',
        actor: access.actor,
        viewing: access.viewing,
        action: 'oc_stock.update',
        targetType: 'oc_stock',
        targetId: id,
        before,
        after,
        success: true,
      }).catch((auditErr: unknown) => {
        console.warn('[api/otter/oc-stock PATCH] audit write failed', auditErr)
      })

      return NextResponse.json({ item: after })
    } catch (err) {
      console.warn('[api/otter/oc-stock PATCH] update failed', err)
      await writeAudit({
        bot: 'otter',
        actor: access.actor,
        viewing: access.viewing,
        action: 'oc_stock.update',
        targetType: 'oc_stock',
        targetId: id,
        before,
        after: parsed,
        success: false,
        errorMessage: err instanceof Error ? err.message : String(err),
      }).catch(() => {})
      return NextResponse.json({ error: 'db-error' }, { status: 500 })
    }
  },
  { require: 'any', csrf: true },
)

export const DELETE = withAuth<[RouteCtx]>(
  async (_req, access, ctx) => {
    if (!(await resolveOcStockAccess(access)).canEdit) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }

    const { id } = await ctx.params
    if (!id) return NextResponse.json({ error: 'invalid id' }, { status: 400 })

    let before: OcStockItem | null = null
    try {
      const [existing] = await otterDb
        .select()
        .from(ocStock)
        .where(eq(ocStock.id, id))
        .limit(1)
      if (!existing) {
        return NextResponse.json({ error: 'not-found' }, { status: 404 })
      }
      before = rowToItem(existing)

      await otterDb.delete(ocStock).where(eq(ocStock.id, id))

      await writeAudit({
        bot: 'otter',
        actor: access.actor,
        viewing: access.viewing,
        action: 'oc_stock.delete',
        targetType: 'oc_stock',
        targetId: id,
        before,
        after: null,
        success: true,
      }).catch((auditErr: unknown) => {
        console.warn('[api/otter/oc-stock DELETE] audit write failed', auditErr)
      })

      return NextResponse.json({ ok: true })
    } catch (err) {
      console.warn('[api/otter/oc-stock DELETE] delete failed', err)
      await writeAudit({
        bot: 'otter',
        actor: access.actor,
        viewing: access.viewing,
        action: 'oc_stock.delete',
        targetType: 'oc_stock',
        targetId: id,
        before,
        after: null,
        success: false,
        errorMessage: err instanceof Error ? err.message : String(err),
      }).catch(() => {})
      return NextResponse.json({ error: 'db-error' }, { status: 500 })
    }
  },
  { require: 'any', csrf: true },
)

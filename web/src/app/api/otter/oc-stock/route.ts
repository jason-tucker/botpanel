/**
 * GET /api/otter/oc-stock — raw OC stock rows as JSON.
 * POST /api/otter/oc-stock — create a new stock item (manager+ of `original-clothing`).
 *
 * GET mirrors what `/otter/oc-stock` server-renders, but as data — useful for
 * future client-side polling and for the manage flow's optimistic update
 * reconciliation. Gated to `'any'` since OC stock is publicly visible in
 * Discord. DB unavailable: 200 with `{ items: [], error: 'db-unavailable' }`
 * — degrade-don't-break.
 *
 * POST is the first write surface in the panel. We gate as `'any'` at the
 * middleware layer and then re-check **manager-or-owner of `original-clothing`
 * (or bot owner)** inside the handler — this matches the page-level `canEdit`
 * check exactly so the API contract and UI affordance stay in lockstep. CSRF
 * is enforced by `withAuth({ csrf: true })` (token verified against the cookie
 * by the parallel write-infra PR). Audit hooks always write via
 * `writeAudit({...})` so the unified `/audit` tail picks up every mutation.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { asc, sql } from 'drizzle-orm'
import { z } from 'zod'
import { withAuth } from '@/lib/auth/middleware'
import { writeAudit } from '@/lib/audit'
import { otterDb } from '@/lib/db/otter'
import { ocStock } from '@/lib/db/schema/otter/ocStock'
import type { AccessMap } from '@/lib/auth/perms'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export type OcStockItem = {
  id: string
  name: string
  status: 'in_stock' | 'low_stock' | 'out_of_stock'
  sortOrder: number
  url: string | null
  updatedAt: string
  updatedByDiscordId: string | null
}

const STATUS_VALUES = ['in_stock', 'low_stock', 'out_of_stock'] as const

const createSchema = z.object({
  name: z.string().trim().min(1).max(200),
  status: z.enum(STATUS_VALUES).optional(),
  sortOrder: z.number().int().optional(),
  url: z
    .string()
    .trim()
    .max(2048)
    .url()
    .optional()
    .or(z.literal('').transform(() => undefined)),
})

function canEditOcStock(access: AccessMap): boolean {
  const rank = access.otter.businesses['original-clothing']
  return access.botOwner || rank === 'owner' || rank === 'manager'
}

export const GET = withAuth(
  async (_req: NextRequest) => {
    try {
      const rows = await otterDb
        .select()
        .from(ocStock)
        .orderBy(asc(ocStock.sortOrder), asc(ocStock.name))

      const items: OcStockItem[] = rows.map((r) => ({
        id: r.id,
        name: r.name,
        status: r.status,
        sortOrder: r.sortOrder,
        url: r.url,
        updatedAt: r.updatedAt.toISOString(),
        updatedByDiscordId: r.updatedByDiscordId,
      }))

      return NextResponse.json({ items })
    } catch (err) {
      console.warn('[api/otter/oc-stock] otterDb read failed', err)
      return NextResponse.json({ items: [], error: 'db-unavailable' })
    }
  },
  { require: 'any' },
)

export const POST = withAuth(
  async (req: NextRequest, access) => {
    if (!canEditOcStock(access)) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }

    let parsed: z.infer<typeof createSchema>
    try {
      const body = (await req.json()) as unknown
      parsed = createSchema.parse(body)
    } catch (err) {
      const message = err instanceof z.ZodError ? err.issues : 'invalid body'
      return NextResponse.json({ error: 'invalid', details: message }, { status: 400 })
    }

    const status = parsed.status ?? 'in_stock'

    try {
      // Compute default sortOrder = max(sort_order) + 1 in one trip; null → 0.
      let nextSort = parsed.sortOrder
      if (nextSort === undefined) {
        const maxRow = await otterDb
          .select({ m: sql<number | null>`max(${ocStock.sortOrder})` })
          .from(ocStock)
        const currentMax = maxRow[0]?.m
        nextSort = (currentMax ?? 0) + 1
      }

      const [inserted] = await otterDb
        .insert(ocStock)
        .values({
          name: parsed.name,
          status,
          sortOrder: nextSort,
          url: parsed.url ?? null,
          updatedByDiscordId: access.viewing.id,
        })
        .returning()

      const item: OcStockItem = {
        id: inserted.id,
        name: inserted.name,
        status: inserted.status,
        sortOrder: inserted.sortOrder,
        url: inserted.url,
        updatedAt: inserted.updatedAt.toISOString(),
        updatedByDiscordId: inserted.updatedByDiscordId,
      }

      await writeAudit({
        bot: 'otter',
        actor: access.actor,
        viewing: access.viewing,
        action: 'oc_stock.create',
        targetType: 'oc_stock',
        targetId: inserted.id,
        before: null,
        after: item,
        success: true,
      }).catch((auditErr: unknown) => {
        // Audit failures must never block a successful write — log and move on.
        console.warn('[api/otter/oc-stock POST] audit write failed', auditErr)
      })

      return NextResponse.json({ item }, { status: 201 })
    } catch (err) {
      console.warn('[api/otter/oc-stock POST] insert failed', err)
      await writeAudit({
        bot: 'otter',
        actor: access.actor,
        viewing: access.viewing,
        action: 'oc_stock.create',
        targetType: 'oc_stock',
        targetId: null,
        before: null,
        after: { name: parsed.name, status, url: parsed.url ?? null },
        success: false,
        errorMessage: err instanceof Error ? err.message : String(err),
      }).catch(() => {})
      return NextResponse.json({ error: 'db-error' }, { status: 500 })
    }
  },
  { require: 'any', csrf: true, rateLimit: { points: 30, perSeconds: 60 } },
)

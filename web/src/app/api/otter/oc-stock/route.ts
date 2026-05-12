/**
 * GET /api/otter/oc-stock — raw OC stock rows as JSON.
 *
 * Mirrors what `/otter/oc-stock` server-renders, but as data — useful for
 * future client-side polling (auto-refresh after a write lands in V2) and for
 * the V2 manage flow's optimistic update reconciliation.
 *
 * Gated to `'any'` — same surface as the page: any signed-in panel user can
 * read, because OC stock is shown publicly in Discord anyway. Write
 * endpoints will be gated to `manager`/`owner` of `original-clothing` (or
 * bot owner) when they land.
 *
 * DB unavailable: 200 with `{ items: [], error: 'db-unavailable' }`. We
 * deliberately do NOT 5xx — the page consumes this shape and we want
 * consistent degrade-don't-break semantics.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { asc } from 'drizzle-orm'
import { withAuth } from '@/lib/auth/middleware'
import { otterDb } from '@/lib/db/otter'
import { ocStock } from '@/lib/db/schema/otter/ocStock'

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

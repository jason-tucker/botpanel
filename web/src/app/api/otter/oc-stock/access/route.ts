/**
 * GET  /api/otter/oc-stock/access — read the OC-stock view/edit rule set.
 * PUT  /api/otter/oc-stock/access — replace it.
 *
 * The rules live in the Otter DB on the `original-clothing` business row
 * under `settings.ocStockAccess`; the shape, the defaults and the
 * never-lock-yourself-out escape hatches are all documented in
 * `@/lib/otter/ocStockAccess`.
 *
 * Gate: **bot owner or OC business owner**, for both verbs — the same gate
 * the role-mappings route uses, and for the same reason. A manager who
 * could edit this could grant their own Discord role `edit` rights on a
 * surface an owner deliberately restricted, so the config stays
 * owner-mediated. GET is gated too because the role allowlist is itself
 * access-control detail; the page tells non-configurers what they can do,
 * not what everyone else can.
 *
 * PUT is a full replace, not a patch — the editor always submits both
 * rules, and a partial merge on a permissions blob is exactly the kind of
 * thing that silently leaves a stale grant in place. Unrelated keys inside
 * `settings` ARE preserved (we read-modify-write the JSONB), so this never
 * clobbers `description` or any bot-owned setting.
 *
 * Body: `{ viewMinRank, viewRoleIds, editMinRank, editRoleIds }` where the
 * roleIds fields accept either an array of snowflakes or a comma-separated
 * string (`<ServerForm>` flattens FormData to scalars, so the editor posts
 * CSV).
 *
 * Audited as `oc_stock.access_updated` with before/after rule sets, and
 * followed by a `publishInvalidate('otter', { table: 'businesses', key })`
 * so any bot-side cache of the row drops it.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { withAuth } from '@/lib/auth/middleware'
import { writeAudit } from '@/lib/audit'
import { publishInvalidate } from '@/lib/events/invalidate'
import { otterDb } from '@/lib/db/otter'
import { businesses } from '@/lib/db/schema/otter/businesses'
import type { AccessMap } from '@/lib/auth/perms'
import {
  MIN_RANK_VALUES,
  OC_ACCESS_SETTINGS_KEY,
  OC_SLUG,
  invalidateOcStockAccessCache,
  loadOcStockAccess,
  parseOcStockAccess,
  type OcStockAccessConfig,
} from '@/lib/otter/ocStockAccess'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const SNOWFLAKE_RE = /^\d{15,25}$/
/** Keeps one careless paste from writing a thousand-entry allowlist. */
const MAX_ROLE_IDS = 25

function canConfigure(access: AccessMap): boolean {
  return access.botOwner || access.otter.businesses[OC_SLUG] === 'owner'
}

/** `"1,2 , 3"` | `['1','2']` | undefined → `['1','2','3']`. */
const roleIdsSchema = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v) => {
    if (v === undefined) return []
    const parts = Array.isArray(v) ? v : v.split(',')
    return [...new Set(parts.map((s) => s.trim()).filter(Boolean))]
  })
  .pipe(
    z
      .array(z.string().regex(SNOWFLAKE_RE, 'role ids must be Discord snowflakes'))
      .max(MAX_ROLE_IDS, `at most ${MAX_ROLE_IDS} roles per rule`),
  )

const bodySchema = z.object({
  viewMinRank: z.enum(MIN_RANK_VALUES),
  editMinRank: z.enum(MIN_RANK_VALUES),
  viewRoleIds: roleIdsSchema,
  editRoleIds: roleIdsSchema,
})

export const GET = withAuth(
  async (_req: NextRequest, access) => {
    if (!canConfigure(access)) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }
    return NextResponse.json({ config: await loadOcStockAccess() })
  },
  { require: 'any' },
)

export const PUT = withAuth(
  async (req: NextRequest, access) => {
    if (!canConfigure(access)) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }

    let parsed: z.infer<typeof bodySchema>
    try {
      parsed = bodySchema.parse((await req.json()) as unknown)
    } catch (err) {
      const details = err instanceof z.ZodError ? err.issues : 'invalid body'
      return NextResponse.json({ error: 'invalid', details }, { status: 400 })
    }

    const next: OcStockAccessConfig = {
      view: { minRank: parsed.viewMinRank, roleIds: parsed.viewRoleIds },
      edit: { minRank: parsed.editMinRank, roleIds: parsed.editRoleIds },
    }

    let before: OcStockAccessConfig | null = null
    try {
      const [row] = await otterDb
        .select({ id: businesses.id, settings: businesses.settings })
        .from(businesses)
        .where(eq(businesses.slug, OC_SLUG))
        .limit(1)
      if (!row) {
        return NextResponse.json({ error: 'business-not-found' }, { status: 404 })
      }
      before = parseOcStockAccess(row.settings)

      // Read-modify-write so bot-owned keys in `settings` survive.
      const merged: Record<string, unknown> = {
        ...(row.settings && typeof row.settings === 'object' ? row.settings : {}),
        [OC_ACCESS_SETTINGS_KEY]: next,
      }

      await otterDb
        .update(businesses)
        .set({
          settings: merged,
          updatedAt: new Date(),
          updatedBy: access.viewing.id,
        })
        .where(eq(businesses.id, row.id))

      invalidateOcStockAccessCache()
      publishInvalidate('otter', { table: 'businesses', key: row.id })

      await writeAudit({
        bot: 'otter',
        actor: access.actor,
        viewing: access.viewing,
        action: 'oc_stock.access_updated',
        targetType: 'business',
        targetId: row.id,
        before,
        after: next,
        success: true,
      }).catch((auditErr: unknown) => {
        console.warn('[api/otter/oc-stock/access PUT] audit write failed', auditErr)
      })

      return NextResponse.json({ config: next })
    } catch (err) {
      console.warn('[api/otter/oc-stock/access PUT] update failed', err)
      await writeAudit({
        bot: 'otter',
        actor: access.actor,
        viewing: access.viewing,
        action: 'oc_stock.access_updated',
        targetType: 'business',
        targetId: null,
        before,
        after: next,
        success: false,
        errorMessage: err instanceof Error ? err.message : String(err),
      }).catch(() => {})
      return NextResponse.json({ error: 'db-error' }, { status: 500 })
    }
  },
  { require: 'any', csrf: true, rateLimit: { points: 20, perSeconds: 60 } },
)

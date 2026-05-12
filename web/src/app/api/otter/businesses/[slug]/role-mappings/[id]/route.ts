/**
 * PATCH /api/otter/businesses/[slug]/role-mappings/[id] — partial update of
 * one role-mapping row (rank / isBase / autoGrantEmployee / minRankToAssign).
 * DELETE — drop the mapping entirely.
 *
 * Gate (both methods): bot owner OR business owner. Same constraint as POST
 * — managers must not reshape the role-rank taxonomy.
 *
 * `id` is the `business_role_mappings.id` UUID. Both methods scope queries
 * to the resolved `businessId` so a forged slug can't reach a mapping row
 * in another business.
 *
 * PATCH is partial — only fields the caller supplies are touched; the
 * `roleId` / `roleName` / `guildId` / `businessId` columns are immutable
 * from this endpoint (use DELETE + POST to re-key a mapping to a different
 * role).
 *
 * DB-ONLY: edits / deletes here do NOT touch any user's Discord roles.
 * Wave 7 command bus handles the Discord side.
 *
 * Audit `role_mapping.updated` / `role_mapping.removed` with `before`/`after`
 * snapshots on success AND failure.
 *
 * CSRF on; rate-limited 20/min/actor.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { eq, and } from 'drizzle-orm'
import { z } from 'zod'
import { withAuth } from '@/lib/auth/middleware'
import type { AccessMap } from '@/lib/auth/perms'
import { writeAudit } from '@/lib/audit'
import { otterDb } from '@/lib/db/otter'
import {
  businesses,
  businessRoleMappings,
} from '@/lib/db/schema/otter/businesses'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const RANK_VALUES = ['owner', 'manager', 'employee'] as const

const patchSchema = z
  .object({
    rank: z.enum(RANK_VALUES).optional(),
    isBase: z.boolean().optional(),
    autoGrantEmployee: z.boolean().optional(),
    minRankToAssign: z.union([z.enum(RANK_VALUES), z.null()]).optional(),
    // Optional role-name re-label — Discord rename happens out of band, and
    // refreshing the cached name shouldn't need a delete-and-re-add cycle.
    roleName: z.string().trim().min(1).max(200).optional(),
  })
  .refine(
    (v) =>
      v.rank !== undefined ||
      v.isBase !== undefined ||
      v.autoGrantEmployee !== undefined ||
      v.minRankToAssign !== undefined ||
      v.roleName !== undefined,
    { message: 'at least one field is required' },
  )

type Patch = z.infer<typeof patchSchema>

async function readJsonOrForm(req: NextRequest): Promise<unknown> {
  const ct = req.headers.get('content-type') ?? ''
  if (ct.includes('application/json')) return req.json()
  if (
    ct.includes('application/x-www-form-urlencoded') ||
    ct.includes('multipart/form-data')
  ) {
    const fd = await req.formData()
    const obj: Record<string, unknown> = {}
    for (const [k, v] of fd.entries()) {
      if (k === '_csrf' || k === '_format') continue
      if (k === 'isBase' || k === 'autoGrantEmployee') {
        obj[k] = v === 'on' || v === 'true' || v === '1'
      } else {
        obj[k] = typeof v === 'string' ? v : ''
      }
    }
    return obj
  }
  return req.json()
}

function canEditMappings(access: AccessMap, slug: string): boolean {
  return access.botOwner || access.otter.businesses[slug] === 'owner'
}

type RouteCtx = { params: Promise<{ slug: string; id: string }> }

type MappingRow = typeof businessRoleMappings.$inferSelect

async function resolveBusinessId(
  slug: string,
): Promise<string | null> {
  const rows = await otterDb
    .select({ id: businesses.id })
    .from(businesses)
    .where(eq(businesses.slug, slug))
    .limit(1)
  return rows[0]?.id ?? null
}

async function loadMapping(
  id: string,
  businessId: string,
): Promise<MappingRow | null> {
  const rows = await otterDb
    .select()
    .from(businessRoleMappings)
    .where(
      and(
        eq(businessRoleMappings.id, id),
        eq(businessRoleMappings.businessId, businessId),
      ),
    )
    .limit(1)
  return rows[0] ?? null
}

function snapshot(row: MappingRow, slug: string): Record<string, unknown> {
  return {
    slug,
    id: row.id,
    businessId: row.businessId,
    guildId: row.guildId,
    roleId: row.roleId,
    roleName: row.roleName,
    rank: row.rank,
    isBase: row.isBase,
    autoGrantEmployee: row.autoGrantEmployee,
    minRankToAssign: row.minRankToAssign,
  }
}

export const PATCH = withAuth<[RouteCtx]>(
  async (req: NextRequest, access, ctx) => {
    const { slug, id } = await ctx.params

    if (!canEditMappings(access, slug)) {
      await writeAudit({
        bot: 'otter',
        actor: access.actor,
        viewing: access.viewing,
        action: 'role_mapping.updated',
        targetType: 'business_role_mappings',
        targetId: id,
        success: false,
        errorMessage: 'forbidden',
        after: { slug },
      }).catch(() => {})
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }

    let patch: Patch
    try {
      const raw = await readJsonOrForm(req)
      patch = patchSchema.parse(raw)
    } catch (err) {
      const details = err instanceof z.ZodError ? err.issues : 'invalid body'
      await writeAudit({
        bot: 'otter',
        actor: access.actor,
        viewing: access.viewing,
        action: 'role_mapping.updated',
        targetType: 'business_role_mappings',
        targetId: id,
        success: false,
        errorMessage: 'invalid-body',
        after: { slug, details },
      }).catch(() => {})
      return NextResponse.json({ error: 'invalid', details }, { status: 400 })
    }

    let businessId: string | null
    try {
      businessId = await resolveBusinessId(slug)
    } catch (err) {
      console.warn('[api/otter/role-mappings PATCH] business lookup failed', err)
      await writeAudit({
        bot: 'otter',
        actor: access.actor,
        viewing: access.viewing,
        action: 'role_mapping.updated',
        targetType: 'business_role_mappings',
        targetId: id,
        success: false,
        errorMessage: err instanceof Error ? err.message : String(err),
        after: { slug, stage: 'business-lookup' },
      }).catch(() => {})
      return NextResponse.json({ error: 'db-error' }, { status: 500 })
    }
    if (!businessId) {
      await writeAudit({
        bot: 'otter',
        actor: access.actor,
        viewing: access.viewing,
        action: 'role_mapping.updated',
        targetType: 'business_role_mappings',
        targetId: id,
        success: false,
        errorMessage: 'business-not-found',
        after: { slug },
      }).catch(() => {})
      return NextResponse.json({ error: 'not-found' }, { status: 404 })
    }

    let before: MappingRow | null
    try {
      before = await loadMapping(id, businessId)
    } catch (err) {
      console.warn('[api/otter/role-mappings PATCH] mapping lookup failed', err)
      await writeAudit({
        bot: 'otter',
        actor: access.actor,
        viewing: access.viewing,
        action: 'role_mapping.updated',
        targetType: 'business_role_mappings',
        targetId: id,
        success: false,
        errorMessage: err instanceof Error ? err.message : String(err),
        after: { slug, stage: 'mapping-lookup' },
      }).catch(() => {})
      return NextResponse.json({ error: 'db-error' }, { status: 500 })
    }
    if (!before) {
      await writeAudit({
        bot: 'otter',
        actor: access.actor,
        viewing: access.viewing,
        action: 'role_mapping.updated',
        targetType: 'business_role_mappings',
        targetId: id,
        success: false,
        errorMessage: 'mapping-not-found',
        after: { slug },
      }).catch(() => {})
      return NextResponse.json({ error: 'not-found' }, { status: 404 })
    }

    const updateSet: Partial<typeof businessRoleMappings.$inferInsert> = {}
    if (patch.rank !== undefined) updateSet.rank = patch.rank
    if (patch.isBase !== undefined) updateSet.isBase = patch.isBase
    if (patch.autoGrantEmployee !== undefined) {
      updateSet.autoGrantEmployee = patch.autoGrantEmployee
    }
    if (patch.minRankToAssign !== undefined) {
      updateSet.minRankToAssign = patch.minRankToAssign ?? 'manager'
    }
    if (patch.roleName !== undefined) updateSet.roleName = patch.roleName

    let after: MappingRow | null = null
    try {
      const rows = await otterDb
        .update(businessRoleMappings)
        .set(updateSet)
        .where(eq(businessRoleMappings.id, id))
        .returning()
      after = rows[0] ?? null
    } catch (err) {
      console.warn('[api/otter/role-mappings PATCH] update failed', err)
      await writeAudit({
        bot: 'otter',
        actor: access.actor,
        viewing: access.viewing,
        action: 'role_mapping.updated',
        targetType: 'business_role_mappings',
        targetId: id,
        before: snapshot(before, slug),
        after: { slug, patch },
        success: false,
        errorMessage: err instanceof Error ? err.message : String(err),
      }).catch(() => {})
      return NextResponse.json({ error: 'db-error' }, { status: 500 })
    }

    await writeAudit({
      bot: 'otter',
      actor: access.actor,
      viewing: access.viewing,
      action: 'role_mapping.updated',
      targetType: 'business_role_mappings',
      targetId: id,
      before: snapshot(before, slug),
      after: after ? snapshot(after, slug) : null,
      success: true,
    }).catch((auditErr: unknown) => {
      console.warn(
        '[api/otter/role-mappings PATCH] audit write failed',
        auditErr,
      )
    })

    return NextResponse.json({ ok: true, id, mapping: after })
  },
  {
    require: 'any',
    csrf: true,
    rateLimit: { points: 20, perSeconds: 60 },
  },
)

export const DELETE = withAuth<[RouteCtx]>(
  async (_req: NextRequest, access, ctx) => {
    const { slug, id } = await ctx.params

    if (!canEditMappings(access, slug)) {
      await writeAudit({
        bot: 'otter',
        actor: access.actor,
        viewing: access.viewing,
        action: 'role_mapping.removed',
        targetType: 'business_role_mappings',
        targetId: id,
        success: false,
        errorMessage: 'forbidden',
        after: { slug },
      }).catch(() => {})
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }

    let businessId: string | null
    try {
      businessId = await resolveBusinessId(slug)
    } catch (err) {
      console.warn('[api/otter/role-mappings DELETE] business lookup failed', err)
      await writeAudit({
        bot: 'otter',
        actor: access.actor,
        viewing: access.viewing,
        action: 'role_mapping.removed',
        targetType: 'business_role_mappings',
        targetId: id,
        success: false,
        errorMessage: err instanceof Error ? err.message : String(err),
        after: { slug, stage: 'business-lookup' },
      }).catch(() => {})
      return NextResponse.json({ error: 'db-error' }, { status: 500 })
    }
    if (!businessId) {
      await writeAudit({
        bot: 'otter',
        actor: access.actor,
        viewing: access.viewing,
        action: 'role_mapping.removed',
        targetType: 'business_role_mappings',
        targetId: id,
        success: false,
        errorMessage: 'business-not-found',
        after: { slug },
      }).catch(() => {})
      return NextResponse.json({ error: 'not-found' }, { status: 404 })
    }

    let before: MappingRow | null
    try {
      before = await loadMapping(id, businessId)
    } catch (err) {
      console.warn(
        '[api/otter/role-mappings DELETE] mapping lookup failed',
        err,
      )
      await writeAudit({
        bot: 'otter',
        actor: access.actor,
        viewing: access.viewing,
        action: 'role_mapping.removed',
        targetType: 'business_role_mappings',
        targetId: id,
        success: false,
        errorMessage: err instanceof Error ? err.message : String(err),
        after: { slug, stage: 'mapping-lookup' },
      }).catch(() => {})
      return NextResponse.json({ error: 'db-error' }, { status: 500 })
    }
    if (!before) {
      await writeAudit({
        bot: 'otter',
        actor: access.actor,
        viewing: access.viewing,
        action: 'role_mapping.removed',
        targetType: 'business_role_mappings',
        targetId: id,
        success: false,
        errorMessage: 'mapping-not-found',
        after: { slug },
      }).catch(() => {})
      return NextResponse.json({ error: 'not-found' }, { status: 404 })
    }

    try {
      await otterDb
        .delete(businessRoleMappings)
        .where(eq(businessRoleMappings.id, id))
    } catch (err) {
      console.warn('[api/otter/role-mappings DELETE] delete failed', err)
      await writeAudit({
        bot: 'otter',
        actor: access.actor,
        viewing: access.viewing,
        action: 'role_mapping.removed',
        targetType: 'business_role_mappings',
        targetId: id,
        before: snapshot(before, slug),
        after: null,
        success: false,
        errorMessage: err instanceof Error ? err.message : String(err),
      }).catch(() => {})
      return NextResponse.json({ error: 'db-error' }, { status: 500 })
    }

    await writeAudit({
      bot: 'otter',
      actor: access.actor,
      viewing: access.viewing,
      action: 'role_mapping.removed',
      targetType: 'business_role_mappings',
      targetId: id,
      before: snapshot(before, slug),
      after: null,
      success: true,
    }).catch((auditErr: unknown) => {
      console.warn(
        '[api/otter/role-mappings DELETE] audit write failed',
        auditErr,
      )
    })

    return NextResponse.json({ ok: true, id })
  },
  {
    require: 'any',
    csrf: true,
    rateLimit: { points: 20, perSeconds: 60 },
  },
)

/**
 * POST /api/otter/businesses/[slug]/role-mappings — add or update one
 * Discord-role → rank mapping for this business.
 *
 * Gate: bot owner OR business owner (`access.otter.businesses[slug] ===
 * 'owner'`). Managers can't reshape the role taxonomy — promoting a Discord
 * role to "owner-rank" would let any wearer of that role grant themselves
 * the panel's owner permissions, so the change stays owner-mediated.
 *
 * Body: `{ roleId, roleName, rank, isBase?, autoGrantEmployee?,
 * minRankToAssign? }`. The business's `guildId` is looked up from the
 * `businesses` row — clients DO NOT supply it, because the unique
 * constraint `(guild_id, role_id)` is the auth boundary: every mapping in
 * a guild is keyed by the role id, and accepting a user-supplied guildId
 * would let a forged request collide with another business's mapping.
 *
 * Upsert: `ON CONFLICT(guild_id, role_id) DO UPDATE` so a re-post against
 * an existing role becomes an edit. We read the existing row first so the
 * audit captures `before` and the response can distinguish `created` vs
 * `updated`.
 *
 * DB-ONLY: this writes the mapping but does NOT touch any user's Discord
 * roles. Discord role assignment / un-assignment lands with the Wave 7
 * command bus — the UI banner says so loudly.
 *
 * Audit `action: 'role_mapping.added'` (new row) or `'role_mapping.updated'`
 * (existing row), success AND failure.
 *
 * CSRF on; rate-limited 20/min/actor — same envelope as other manager+
 * Otter writes.
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

const SNOWFLAKE_RE = /^\d{15,25}$/
const RANK_VALUES = ['owner', 'manager', 'employee'] as const

const bodySchema = z.object({
  roleId: z
    .string()
    .trim()
    .regex(SNOWFLAKE_RE, 'roleId must be a Discord snowflake (15-25 digits)'),
  roleName: z.string().trim().min(1).max(200),
  rank: z.enum(RANK_VALUES),
  isBase: z.boolean().optional(),
  autoGrantEmployee: z.boolean().optional(),
  // `null` → reset to schema default ('manager') by omitting from the patch.
  minRankToAssign: z
    .union([z.enum(RANK_VALUES), z.null()])
    .optional(),
})

type ParsedBody = z.infer<typeof bodySchema>

/**
 * `<ServerForm>` defaults to JSON since Wave 6.5 but a few legacy form posts
 * still hit these routes — accept both. Booleans coming in via form encoding
 * arrive as the strings `'on'` / `'true'` / `'1'` (or absent for false); we
 * normalise BEFORE zod parses so the schema can stay typed as `boolean`.
 */
async function readBody(req: NextRequest): Promise<unknown> {
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

type RouteCtx = { params: Promise<{ slug: string }> }

export const POST = withAuth<[RouteCtx]>(
  async (req: NextRequest, access, ctx) => {
    const { slug } = await ctx.params

    if (!canEditMappings(access, slug)) {
      await writeAudit({
        bot: 'otter',
        actor: access.actor,
        viewing: access.viewing,
        action: 'role_mapping.added',
        targetType: 'business_role_mappings',
        success: false,
        errorMessage: 'forbidden',
        after: { slug },
      }).catch(() => {})
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }

    let body: ParsedBody
    try {
      const raw = await readBody(req)
      body = bodySchema.parse(raw)
    } catch (err) {
      const details = err instanceof z.ZodError ? err.issues : 'invalid body'
      await writeAudit({
        bot: 'otter',
        actor: access.actor,
        viewing: access.viewing,
        action: 'role_mapping.added',
        targetType: 'business_role_mappings',
        success: false,
        errorMessage: 'invalid-body',
        after: { slug, details },
      }).catch(() => {})
      return NextResponse.json({ error: 'invalid', details }, { status: 400 })
    }

    // Resolve the business + its guildId. The guildId is server-derived; a
    // user-supplied guildId would let a forged POST shadow another business's
    // mapping via the (guild_id, role_id) unique key.
    let businessId: string
    let guildId: string
    try {
      const rows = await otterDb
        .select({ id: businesses.id, guildId: businesses.guildId })
        .from(businesses)
        .where(eq(businesses.slug, slug))
        .limit(1)
      const found = rows[0]
      if (!found) {
        await writeAudit({
          bot: 'otter',
          actor: access.actor,
          viewing: access.viewing,
          action: 'role_mapping.added',
          targetType: 'business_role_mappings',
          success: false,
          errorMessage: 'business-not-found',
          after: { slug, roleId: body.roleId },
        }).catch(() => {})
        return NextResponse.json({ error: 'not-found' }, { status: 404 })
      }
      businessId = found.id
      guildId = found.guildId
    } catch (err) {
      console.warn('[api/otter/role-mappings POST] business lookup failed', err)
      await writeAudit({
        bot: 'otter',
        actor: access.actor,
        viewing: access.viewing,
        action: 'role_mapping.added',
        targetType: 'business_role_mappings',
        success: false,
        errorMessage: err instanceof Error ? err.message : String(err),
        after: { slug, stage: 'business-lookup' },
      }).catch(() => {})
      return NextResponse.json({ error: 'db-error' }, { status: 500 })
    }

    // Capture `before` so the audit can show a diff on upsert + we can pick
    // the right action name (added vs updated). Scoped to this business so
    // a same-roleId row in another business in the same guild is still seen
    // here (it would collide on the unique key and become an update on the
    // OTHER row — that's a real conflict; we return 409 below).
    let before: {
      id: string
      businessId: string
      roleId: string
      roleName: string | null
      rank: 'owner' | 'manager' | 'employee'
      isBase: boolean
      autoGrantEmployee: boolean
      minRankToAssign: 'owner' | 'manager' | 'employee'
    } | null = null
    let conflictWithOtherBusiness = false
    try {
      const rows = await otterDb
        .select({
          id: businessRoleMappings.id,
          businessId: businessRoleMappings.businessId,
          roleId: businessRoleMappings.roleId,
          roleName: businessRoleMappings.roleName,
          rank: businessRoleMappings.rank,
          isBase: businessRoleMappings.isBase,
          autoGrantEmployee: businessRoleMappings.autoGrantEmployee,
          minRankToAssign: businessRoleMappings.minRankToAssign,
        })
        .from(businessRoleMappings)
        .where(
          and(
            eq(businessRoleMappings.guildId, guildId),
            eq(businessRoleMappings.roleId, body.roleId),
          ),
        )
        .limit(1)
      const existing = rows[0]
      if (existing) {
        if (existing.businessId !== businessId) {
          conflictWithOtherBusiness = true
        } else {
          before = existing
        }
      }
    } catch (err) {
      // Non-fatal — we just won't have a before snapshot.
      console.warn(
        '[api/otter/role-mappings POST] before lookup failed',
        err,
      )
    }

    if (conflictWithOtherBusiness) {
      await writeAudit({
        bot: 'otter',
        actor: access.actor,
        viewing: access.viewing,
        action: 'role_mapping.added',
        targetType: 'business_role_mappings',
        success: false,
        errorMessage: 'role-id-already-mapped-in-guild',
        after: { slug, guildId, roleId: body.roleId },
      }).catch(() => {})
      return NextResponse.json(
        { error: 'role-id-already-mapped-in-guild' },
        { status: 409 },
      )
    }

    const action: 'role_mapping.added' | 'role_mapping.updated' = before
      ? 'role_mapping.updated'
      : 'role_mapping.added'

    // Build the insert value AND the conflict-update SET separately so the
    // update branch only touches columns the caller actually supplied
    // (omitted optional flags don't clobber existing values).
    const insertValues = {
      businessId,
      guildId,
      roleId: body.roleId,
      roleName: body.roleName,
      rank: body.rank,
      isBase: body.isBase ?? false,
      autoGrantEmployee: body.autoGrantEmployee ?? false,
      minRankToAssign: body.minRankToAssign ?? 'manager',
    } as const

    const updateSet: Partial<typeof businessRoleMappings.$inferInsert> = {
      roleName: body.roleName,
      rank: body.rank,
    }
    if (body.isBase !== undefined) updateSet.isBase = body.isBase
    if (body.autoGrantEmployee !== undefined) {
      updateSet.autoGrantEmployee = body.autoGrantEmployee
    }
    if (body.minRankToAssign !== undefined) {
      updateSet.minRankToAssign = body.minRankToAssign ?? 'manager'
    }

    let resultId: string | null = null
    let after: typeof businessRoleMappings.$inferSelect | null = null
    try {
      const rows = await otterDb
        .insert(businessRoleMappings)
        .values(insertValues)
        .onConflictDoUpdate({
          target: [businessRoleMappings.guildId, businessRoleMappings.roleId],
          set: updateSet,
        })
        .returning()
      after = rows[0] ?? null
      resultId = after?.id ?? null
    } catch (err) {
      console.warn('[api/otter/role-mappings POST] upsert failed', err)
      await writeAudit({
        bot: 'otter',
        actor: access.actor,
        viewing: access.viewing,
        action,
        targetType: 'business_role_mappings',
        targetId: before?.id ?? null,
        before,
        after: { slug, ...insertValues },
        success: false,
        errorMessage: err instanceof Error ? err.message : String(err),
      }).catch(() => {})
      return NextResponse.json({ error: 'db-error' }, { status: 500 })
    }

    await writeAudit({
      bot: 'otter',
      actor: access.actor,
      viewing: access.viewing,
      action,
      targetType: 'business_role_mappings',
      targetId: resultId,
      before,
      after: after
        ? {
            slug,
            id: after.id,
            businessId: after.businessId,
            guildId: after.guildId,
            roleId: after.roleId,
            roleName: after.roleName,
            rank: after.rank,
            isBase: after.isBase,
            autoGrantEmployee: after.autoGrantEmployee,
            minRankToAssign: after.minRankToAssign,
          }
        : { slug, ...insertValues },
      success: true,
    }).catch((auditErr: unknown) => {
      console.warn(
        '[api/otter/role-mappings POST] audit write failed',
        auditErr,
      )
    })

    return NextResponse.json({
      ok: true,
      created: !before,
      id: resultId,
      mapping: after,
    })
  },
  {
    require: 'any',
    csrf: true,
    rateLimit: { points: 20, perSeconds: 60 },
  },
)

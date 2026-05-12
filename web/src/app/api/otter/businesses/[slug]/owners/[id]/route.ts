/**
 * DELETE /api/otter/businesses/[slug]/owners/[id] — remove a business owner row.
 *
 * Gate: **bot owner only.** Symmetric with the POST gate — owners can't
 * remove each other through the panel; revoking ownership stays a sudo /
 * `/portal` job. (Otter's command-bus surface will eventually mirror this
 * exact constraint.)
 *
 * `id` is the `business_owners.id` UUID, NOT a Discord user id — we delete by
 * primary key scoped to the resolved business so a forged slug can't reach
 * an owner row from another business.
 *
 * Read-before-delete so the audit `before` snapshot captures the row
 * (discordUserId, addedByDiscordId, addedAt) and the operator can rebuild
 * the grant by hand from `/audit` if a delete was accidental.
 *
 * DB-ONLY: this drops the panel-authoritative row but does NOT touch
 * Discord roles. Discord role removal lands with the Wave 7 command bus.
 *
 * Audit `action: 'business_owner.removed'` on success AND failure.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { eq, and } from 'drizzle-orm'
import { withAuth } from '@/lib/auth/middleware'
import { writeAudit } from '@/lib/audit'
import { otterDb } from '@/lib/db/otter'
import { businesses } from '@/lib/db/schema/otter/businesses'
import { businessOwners } from '@/lib/db/schema/otter/businessOwners'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type RouteCtx = { params: Promise<{ slug: string; id: string }> }

export const DELETE = withAuth<[RouteCtx]>(
  async (_req: NextRequest, access, ctx) => {
    const { slug, id } = await ctx.params

    // Resolve businessId first — gives us a scope to constrain the delete
    // so a row id from a different business can't be deleted via a forged
    // slug, and lets us 404 cleanly when the slug is bogus.
    let businessId: string
    try {
      const rows = await otterDb
        .select({ id: businesses.id })
        .from(businesses)
        .where(eq(businesses.slug, slug))
        .limit(1)
      const found = rows[0]?.id
      if (!found) {
        await writeAudit({
          bot: 'otter',
          actor: access.actor,
          viewing: access.viewing,
          action: 'business_owner.removed',
          targetType: 'business_owners',
          targetId: id,
          success: false,
          errorMessage: 'business-not-found',
          after: { slug },
        }).catch(() => {})
        return NextResponse.json({ error: 'not-found' }, { status: 404 })
      }
      businessId = found
    } catch (err) {
      console.warn('[api/otter/owners DELETE] business lookup failed', err)
      await writeAudit({
        bot: 'otter',
        actor: access.actor,
        viewing: access.viewing,
        action: 'business_owner.removed',
        targetType: 'business_owners',
        targetId: id,
        success: false,
        errorMessage: err instanceof Error ? err.message : String(err),
        after: { slug, stage: 'business-lookup' },
      }).catch(() => {})
      return NextResponse.json({ error: 'db-error' }, { status: 500 })
    }

    // Load the owner row scoped to this business.
    let before: {
      id: string
      businessId: string
      discordUserId: string
      addedByDiscordId: string
      addedAt: Date | null
    } | null = null
    try {
      const rows = await otterDb
        .select({
          id: businessOwners.id,
          businessId: businessOwners.businessId,
          discordUserId: businessOwners.discordUserId,
          addedByDiscordId: businessOwners.addedByDiscordId,
          addedAt: businessOwners.addedAt,
        })
        .from(businessOwners)
        .where(
          and(
            eq(businessOwners.id, id),
            eq(businessOwners.businessId, businessId),
          ),
        )
        .limit(1)
      before = rows[0] ?? null
    } catch (err) {
      console.warn('[api/otter/owners DELETE] owner lookup failed', err)
      await writeAudit({
        bot: 'otter',
        actor: access.actor,
        viewing: access.viewing,
        action: 'business_owner.removed',
        targetType: 'business_owners',
        targetId: id,
        success: false,
        errorMessage: err instanceof Error ? err.message : String(err),
        after: { slug, stage: 'owner-lookup' },
      }).catch(() => {})
      return NextResponse.json({ error: 'db-error' }, { status: 500 })
    }

    if (!before) {
      await writeAudit({
        bot: 'otter',
        actor: access.actor,
        viewing: access.viewing,
        action: 'business_owner.removed',
        targetType: 'business_owners',
        targetId: id,
        success: false,
        errorMessage: 'owner-not-found',
        after: { slug },
      }).catch(() => {})
      return NextResponse.json({ error: 'not-found' }, { status: 404 })
    }

    try {
      await otterDb.delete(businessOwners).where(eq(businessOwners.id, id))
    } catch (err) {
      console.warn('[api/otter/owners DELETE] delete failed', err)
      await writeAudit({
        bot: 'otter',
        actor: access.actor,
        viewing: access.viewing,
        action: 'business_owner.removed',
        targetType: 'business_owners',
        targetId: id,
        before,
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
      action: 'business_owner.removed',
      targetType: 'business_owners',
      targetId: id,
      before: {
        businessId: before.businessId,
        discordUserId: before.discordUserId,
        addedByDiscordId: before.addedByDiscordId,
        addedAt: before.addedAt?.toISOString() ?? null,
        slug,
      },
      after: null,
      success: true,
    }).catch((auditErr: unknown) => {
      console.warn('[api/otter/owners DELETE] audit write failed', auditErr)
    })

    return NextResponse.json({
      ok: true,
      id,
      discordUserId: before.discordUserId,
    })
  },
  {
    require: 'botOwner',
    csrf: true,
    rateLimit: { points: 10, perSeconds: 60 },
  },
)

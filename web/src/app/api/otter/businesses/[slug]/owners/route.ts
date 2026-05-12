/**
 * POST /api/otter/businesses/[slug]/owners — add a Discord user to the
 * authoritative `business_owners` list for this business.
 *
 * Gate: **bot owner only.** Otter's `/portal` `transfer owner` slash command
 * is sudo-only in Discord — this surface mirrors that exact constraint.
 * Business owners CANNOT add other owners through the panel; promoting a
 * staff member to owner is a deliberate, owner-mediated act.
 *
 * Body: `{ discordUserId: string }` matching the Discord snowflake
 * `/^\d{15,25}$/`. We accept JSON or form-encoded so `<ServerForm>` defaults
 * work either way.
 *
 * Idempotent: `ON CONFLICT(business_id, discord_user_id) DO NOTHING` — the
 * `uq_owner_per_business` constraint means a re-add silently no-ops and
 * surfaces as `added:false` in the response. The audit row is still written
 * (success=true) so we can see the attempt.
 *
 * DB-ONLY: this writes the `business_owners` row but does NOT touch Discord.
 * Discord role assignment is the Wave 7 command-bus job. The UI banners this
 * loudly; the audit `after` payload includes `via:'web'` so it's distinct
 * from in-bot grants.
 *
 * CSRF on; rate-limited 10/min/actor — same envelope as `/api/sudo/users`
 * because ownership grants are paired with revokes and both should feel
 * deliberate, not bulk.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { withAuth } from '@/lib/auth/middleware'
import { writeAudit } from '@/lib/audit'
import { otterDb } from '@/lib/db/otter'
import { businesses } from '@/lib/db/schema/otter/businesses'
import { businessOwners } from '@/lib/db/schema/otter/businessOwners'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const SNOWFLAKE_RE = /^\d{15,25}$/

const bodySchema = z.object({
  discordUserId: z
    .string()
    .trim()
    .regex(SNOWFLAKE_RE, 'discordUserId must be a Discord snowflake (15-25 digits)'),
})

type ParsedBody = z.infer<typeof bodySchema>

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
      obj[k] = typeof v === 'string' ? v : ''
    }
    return obj
  }
  return req.json()
}

type RouteCtx = { params: Promise<{ slug: string }> }

export const POST = withAuth<[RouteCtx]>(
  async (req: NextRequest, access, ctx) => {
    const { slug } = await ctx.params

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
        action: 'business_owner.added',
        targetType: 'business_owners',
        success: false,
        errorMessage: 'invalid-body',
        after: { slug, details },
      }).catch(() => {})
      return NextResponse.json({ error: 'invalid', details }, { status: 400 })
    }

    // Resolve businessId from slug.
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
          action: 'business_owner.added',
          targetType: 'business_owners',
          success: false,
          errorMessage: 'business-not-found',
          after: { slug, discordUserId: body.discordUserId },
        }).catch(() => {})
        return NextResponse.json({ error: 'not-found' }, { status: 404 })
      }
      businessId = found
    } catch (err) {
      console.warn('[api/otter/owners POST] business lookup failed', err)
      await writeAudit({
        bot: 'otter',
        actor: access.actor,
        viewing: access.viewing,
        action: 'business_owner.added',
        targetType: 'business_owners',
        success: false,
        errorMessage: err instanceof Error ? err.message : String(err),
        after: { slug, stage: 'business-lookup' },
      }).catch(() => {})
      return NextResponse.json({ error: 'db-error' }, { status: 500 })
    }

    let insertedId: string | null = null
    try {
      const inserted = await otterDb
        .insert(businessOwners)
        .values({
          businessId,
          discordUserId: body.discordUserId,
          addedByDiscordId: access.viewing.id,
        })
        .onConflictDoNothing({
          target: [businessOwners.businessId, businessOwners.discordUserId],
        })
        .returning({ id: businessOwners.id })
      insertedId = inserted[0]?.id ?? null
    } catch (err) {
      console.warn('[api/otter/owners POST] insert failed', err)
      await writeAudit({
        bot: 'otter',
        actor: access.actor,
        viewing: access.viewing,
        action: 'business_owner.added',
        targetType: 'business_owners',
        success: false,
        errorMessage: err instanceof Error ? err.message : String(err),
        before: null,
        after: { slug, businessId, discordUserId: body.discordUserId },
      }).catch(() => {})
      return NextResponse.json({ error: 'db-error' }, { status: 500 })
    }

    const added = insertedId !== null

    await writeAudit({
      bot: 'otter',
      actor: access.actor,
      viewing: access.viewing,
      action: 'business_owner.added',
      targetType: 'business_owners',
      targetId: insertedId,
      before: null,
      after: added
        ? { businessId, discordUserId: body.discordUserId, slug }
        : {
            businessId,
            discordUserId: body.discordUserId,
            slug,
            alreadyPresent: true,
          },
      success: true,
    }).catch((auditErr: unknown) => {
      console.warn('[api/otter/owners POST] audit write failed', auditErr)
    })

    return NextResponse.json({
      ok: true,
      added,
      id: insertedId,
      businessId,
      discordUserId: body.discordUserId,
    })
  },
  {
    require: 'botOwner',
    csrf: true,
    rateLimit: { points: 10, perSeconds: 60 },
  },
)

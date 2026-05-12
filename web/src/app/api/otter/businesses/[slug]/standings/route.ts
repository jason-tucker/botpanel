/**
 * POST /api/otter/businesses/[slug]/standings — record (or update) a standing
 * for a character at this business.
 *
 * Gate: bot owner OR any rank in this business (`access.otter.businesses[slug]`).
 *   Standings are an employee+ action — frontline staff should be able to flag
 *   a customer as bad/blacklisted without escalating to a manager. The
 *   `withAuth({ require: 'any' })` wrapper only enforces "logged in"; the
 *   capability check happens in-handler so we can audit the gate-failure.
 *
 * Body (JSON or `application/x-www-form-urlencoded`): `{ characterId,
 * characterName?, standing, reason? }`. Drizzle upsert on `(business_id,
 * character_id)` — one standing row per character per business (the schema
 * enforces this with `uq_standing_per_business_char`); we read the existing
 * row before the upsert so the audit can record a `before`/`after` diff.
 *
 * Audit `action: 'standing.set'`, success AND failure. We audit BEFORE
 * returning any error response so gate-rejections, validation failures, and
 * DB errors all surface in the unified `/audit` tail.
 *
 * `csrf: true` (the default) — every state-changing request must carry the
 * double-submit token issued by `GET /api/csrf`. `<ServerForm>` does this
 * automatically; raw `fetch()` callers must echo the `x-csrf-token` header.
 *
 * Rate-limit: 20 standings per 60s per actor per route. Generous enough that
 * a manager doing a bulk-flag session never trips it, tight enough that a
 * runaway script gets stopped within a second.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { eq, and } from 'drizzle-orm'
import { z } from 'zod'
import { withAuth } from '@/lib/auth/middleware'
import type { AccessMap } from '@/lib/auth/perms'
import { writeAudit } from '@/lib/audit'
import { otterDb } from '@/lib/db/otter'
import { businesses } from '@/lib/db/schema/otter/businesses'
import { standings } from '@/lib/db/schema/otter/standings'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const STANDING_VALUES = ['good', 'neutral', 'bad', 'blacklisted'] as const
type StandingValue = (typeof STANDING_VALUES)[number]

const bodySchema = z.object({
  characterId: z.string().trim().min(1).max(200),
  characterName: z
    .union([z.string().trim().max(200), z.literal('')])
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  standing: z.enum(STANDING_VALUES),
  reason: z
    .union([z.string().trim().max(2000), z.literal('')])
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
})

type ParsedBody = z.infer<typeof bodySchema>

async function readBody(req: NextRequest): Promise<unknown> {
  const ct = req.headers.get('content-type') ?? ''
  if (ct.includes('application/json')) {
    return req.json()
  }
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
  // Last resort: try JSON.
  return req.json()
}

function canWrite(access: AccessMap, slug: string): boolean {
  return access.botOwner || Boolean(access.otter.businesses[slug])
}

type RouteCtx = { params: Promise<{ slug: string }> }

export const POST = withAuth<[RouteCtx]>(
  async (req, access, ctx) => {
    const { slug } = await ctx.params

    if (!canWrite(access, slug)) {
      await writeAudit({
        bot: 'otter',
        actor: access.actor,
        viewing: access.viewing,
        action: 'standing.set',
        targetType: 'standings',
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
        action: 'standing.set',
        targetType: 'standings',
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
          action: 'standing.set',
          targetType: 'standings',
          targetId: body.characterId,
          success: false,
          errorMessage: 'business-not-found',
          after: { slug },
        }).catch(() => {})
        return NextResponse.json({ error: 'not-found' }, { status: 404 })
      }
      businessId = found
    } catch (err) {
      console.warn('[api/otter/standings POST] business lookup failed', err)
      await writeAudit({
        bot: 'otter',
        actor: access.actor,
        viewing: access.viewing,
        action: 'standing.set',
        targetType: 'standings',
        targetId: body.characterId,
        success: false,
        errorMessage: err instanceof Error ? err.message : String(err),
        after: { slug, stage: 'business-lookup' },
      }).catch(() => {})
      return NextResponse.json({ error: 'db-error' }, { status: 500 })
    }

    // Capture `before` for the audit diff before the upsert overwrites it.
    let before: {
      standing: StandingValue
      reason: string | null
      characterName: string
    } | null = null
    try {
      const existing = await otterDb
        .select({
          standing: standings.standing,
          reason: standings.reason,
          characterName: standings.characterName,
        })
        .from(standings)
        .where(
          and(
            eq(standings.businessId, businessId),
            eq(standings.characterId, body.characterId),
          ),
        )
        .limit(1)
      if (existing[0]) {
        before = {
          standing: existing[0].standing,
          reason: existing[0].reason,
          characterName: existing[0].characterName,
        }
      }
    } catch (err) {
      // Non-fatal — we just won't have a before snapshot.
      console.warn('[api/otter/standings POST] before lookup failed', err)
    }

    const characterName =
      body.characterName ?? before?.characterName ?? body.characterId
    const updatedByDiscordId = access.viewing.id
    const reason = body.reason ?? null
    const now = new Date()

    try {
      await otterDb
        .insert(standings)
        .values({
          businessId,
          characterId: body.characterId,
          characterName,
          standing: body.standing,
          reason,
          updatedByDiscordId,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [standings.businessId, standings.characterId],
          set: {
            standing: body.standing,
            reason,
            characterName,
            updatedByDiscordId,
            updatedAt: now,
          },
        })
    } catch (err) {
      console.warn('[api/otter/standings POST] upsert failed', err)
      await writeAudit({
        bot: 'otter',
        actor: access.actor,
        viewing: access.viewing,
        action: 'standing.set',
        targetType: 'standings',
        targetId: body.characterId,
        before,
        after: { standing: body.standing, reason, characterName },
        success: false,
        errorMessage: err instanceof Error ? err.message : String(err),
      }).catch(() => {})
      return NextResponse.json({ error: 'db-error' }, { status: 500 })
    }

    const after = {
      standing: body.standing,
      reason,
      characterName,
      slug,
    }

    await writeAudit({
      bot: 'otter',
      actor: access.actor,
      viewing: access.viewing,
      action: 'standing.set',
      targetType: 'standings',
      targetId: body.characterId,
      before,
      after,
      success: true,
    }).catch((auditErr: unknown) => {
      console.warn('[api/otter/standings POST] audit write failed', auditErr)
    })

    return NextResponse.json({
      ok: true,
      characterId: body.characterId,
      standing: body.standing,
      characterName,
      reason,
    })
  },
  {
    require: 'any',
    csrf: true,
    rateLimit: { points: 20, perSeconds: 60 },
  },
)

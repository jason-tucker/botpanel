/**
 * POST /api/otter/businesses/[slug]/notes — author a note on this business.
 *
 * Visibility-vs-rank gate is the whole point of this endpoint. The `visibility`
 * column controls reads AND writes — a manager cannot author an owner-only
 * note (that would be ghost-writing into a tier they can't read), an employee
 * cannot author a manager-only note, and so on. Bot owner can write any tier
 * without an explicit rank in the business.
 *
 *   employee → can write: ['staff']
 *   manager  → can write: ['staff', 'manager']
 *   owner    → can write: ['staff', 'manager', 'owner']
 *   botOwner → can write: ['staff', 'manager', 'owner']
 *
 * Body (JSON or form-encoded): `{ characterId, content, visibility,
 * characterName? }`. Content trimmed, non-empty, < 4000 chars. characterName,
 * when omitted, is back-filled from the most recent note or standings row
 * for the same character so the list stays readable without re-typing.
 *
 * Audit `action: 'note.added'`, success AND failure. An employee trying to
 * post an owner-tier note shows up in the audit log with `success=false`.
 *
 * Rate-limit: 30 notes per 60s — staff writing rapid case notes shouldn't
 * see a 429 in normal operation; runaway clients get throttled fast.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { eq, and, desc } from 'drizzle-orm'
import { z } from 'zod'
import { withAuth } from '@/lib/auth/middleware'
import type { AccessMap, BusinessRank } from '@/lib/auth/perms'
import { writeAudit } from '@/lib/audit'
import { otterDb } from '@/lib/db/otter'
import { businesses } from '@/lib/db/schema/otter/businesses'
import { notes } from '@/lib/db/schema/otter/notes'
import { standings } from '@/lib/db/schema/otter/standings'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const VISIBILITY_VALUES = ['staff', 'manager', 'owner'] as const
export type NoteVisibility = (typeof VISIBILITY_VALUES)[number]

const MAX_CONTENT = 4000

const bodySchema = z.object({
  characterId: z.string().trim().min(1).max(200),
  content: z.string().trim().min(1).max(MAX_CONTENT - 1),
  visibility: z.enum(VISIBILITY_VALUES),
  characterName: z
    .union([z.string().trim().max(200), z.literal('')])
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
})

type ParsedBody = z.infer<typeof bodySchema>

/**
 * Highest visibility this viewer may author at this business. Mirrored in
 * the notes page so the form select only offers tiers the user will pass.
 */
function maxWritableVisibility(
  rank: BusinessRank | null,
  botOwner: boolean,
): NoteVisibility | null {
  if (botOwner) return 'owner'
  if (rank === 'owner') return 'owner'
  if (rank === 'manager') return 'manager'
  if (rank === 'employee') return 'staff'
  return null
}

const VIS_RANK: Record<NoteVisibility, number> = {
  staff: 0,
  manager: 1,
  owner: 2,
}

function canWriteVisibility(
  requested: NoteVisibility,
  ceiling: NoteVisibility | null,
): boolean {
  if (!ceiling) return false
  return VIS_RANK[requested] <= VIS_RANK[ceiling]
}

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
  return req.json()
}

async function resolveCharacterName(
  businessId: string,
  characterId: string,
  override: string | undefined,
): Promise<string> {
  if (override) return override
  try {
    const prior = await otterDb
      .select({ characterName: notes.characterName })
      .from(notes)
      .where(
        and(eq(notes.businessId, businessId), eq(notes.characterId, characterId)),
      )
      .orderBy(desc(notes.createdAt))
      .limit(1)
    if (prior[0]?.characterName) return prior[0].characterName
  } catch (err) {
    console.warn('[api/otter/notes POST] prior-note name lookup failed', err)
  }
  try {
    const st = await otterDb
      .select({ characterName: standings.characterName })
      .from(standings)
      .where(
        and(
          eq(standings.businessId, businessId),
          eq(standings.characterId, characterId),
        ),
      )
      .limit(1)
    if (st[0]?.characterName) return st[0].characterName
  } catch (err) {
    console.warn('[api/otter/notes POST] standings name lookup failed', err)
  }
  return characterId
}

type RouteCtx = { params: Promise<{ slug: string }> }

export const POST = withAuth<[RouteCtx]>(
  async (req: NextRequest, access: AccessMap, ctx) => {
    const { slug } = await ctx.params

    const rank = access.otter.businesses[slug] ?? null
    const ceiling = maxWritableVisibility(rank, access.botOwner)
    if (!ceiling) {
      await writeAudit({
        bot: 'otter',
        actor: access.actor,
        viewing: access.viewing,
        action: 'note.added',
        targetType: 'notes',
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
        action: 'note.added',
        targetType: 'notes',
        success: false,
        errorMessage: 'invalid-body',
        after: { slug, details },
      }).catch(() => {})
      return NextResponse.json({ error: 'invalid', details }, { status: 400 })
    }

    // Visibility-vs-rank ceiling check.
    if (!canWriteVisibility(body.visibility, ceiling)) {
      await writeAudit({
        bot: 'otter',
        actor: access.actor,
        viewing: access.viewing,
        action: 'note.added',
        targetType: 'notes',
        targetId: body.characterId,
        success: false,
        errorMessage: 'visibility-exceeds-rank',
        after: {
          slug,
          requested: body.visibility,
          ceiling,
          rank,
        },
      }).catch(() => {})
      return NextResponse.json(
        { error: 'visibility-exceeds-rank', ceiling },
        { status: 403 },
      )
    }

    // Resolve businessId.
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
          action: 'note.added',
          targetType: 'notes',
          targetId: body.characterId,
          success: false,
          errorMessage: 'business-not-found',
          after: { slug },
        }).catch(() => {})
        return NextResponse.json({ error: 'not-found' }, { status: 404 })
      }
      businessId = found
    } catch (err) {
      console.warn('[api/otter/notes POST] business lookup failed', err)
      await writeAudit({
        bot: 'otter',
        actor: access.actor,
        viewing: access.viewing,
        action: 'note.added',
        targetType: 'notes',
        targetId: body.characterId,
        success: false,
        errorMessage: err instanceof Error ? err.message : String(err),
        after: { slug, stage: 'business-lookup' },
      }).catch(() => {})
      return NextResponse.json({ error: 'db-error' }, { status: 500 })
    }

    const characterName = await resolveCharacterName(
      businessId,
      body.characterId,
      body.characterName,
    )

    let insertedId: string | null = null
    try {
      const inserted = await otterDb
        .insert(notes)
        .values({
          businessId,
          characterId: body.characterId,
          characterName,
          content: body.content,
          // Audit `actor` is the real user; the row's authorship reflects the
          // ACTING identity (`viewing.id`) so a bot-owner impersonating staff
          // shows up as that staff member on the note, with the impersonation
          // captured in the audit row.
          authorDiscordId: access.viewing.id,
          authorName: access.viewing.username || access.viewing.id,
          visibility: body.visibility,
        })
        .returning({ id: notes.id })
      insertedId = inserted[0]?.id ?? null
    } catch (err) {
      console.warn('[api/otter/notes POST] insert failed', err)
      await writeAudit({
        bot: 'otter',
        actor: access.actor,
        viewing: access.viewing,
        action: 'note.added',
        targetType: 'notes',
        targetId: body.characterId,
        success: false,
        errorMessage: err instanceof Error ? err.message : String(err),
        after: {
          slug,
          visibility: body.visibility,
          stage: 'insert',
        },
      }).catch(() => {})
      return NextResponse.json({ error: 'db-error' }, { status: 500 })
    }

    await writeAudit({
      bot: 'otter',
      actor: access.actor,
      viewing: access.viewing,
      action: 'note.added',
      targetType: 'notes',
      targetId: insertedId ?? body.characterId,
      after: {
        slug,
        characterId: body.characterId,
        characterName,
        visibility: body.visibility,
        contentLength: body.content.length,
      },
      success: true,
    }).catch((auditErr: unknown) => {
      console.warn('[api/otter/notes POST] audit write failed', auditErr)
    })

    return NextResponse.json({
      ok: true,
      id: insertedId,
      characterId: body.characterId,
      visibility: body.visibility,
    })
  },
  {
    require: 'any',
    csrf: true,
    rateLimit: { points: 30, perSeconds: 60 },
  },
)

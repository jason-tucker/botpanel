/**
 * DELETE /api/otter/businesses/[slug]/notes/[noteId] — remove a note.
 *
 * Gate (any of):
 *   - bot owner
 *   - the note's author (`notes.authorDiscordId === access.viewing.id`)
 *   - an owner of this business (`access.otter.businesses[slug] === 'owner'`)
 *
 * The author check compares against `viewing.id` so a bot-owner impersonating
 * the author can still self-delete (the audit row records both real-actor +
 * viewing — privileges aren't escalated, but the natural author surface still
 * works under View-As).
 *
 * Audit `action: 'note.removed'` on success AND failure. The audit `before`
 * snapshot records the deleted note in full so an accidental delete can be
 * reconstructed by hand from the audit log.
 *
 * Rate-limit: 30 deletes per 60s — bulk-purge sessions should still feel
 * snappy, runaway clients get throttled.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { eq, and } from 'drizzle-orm'
import { withAuth } from '@/lib/auth/middleware'
import type { AccessMap } from '@/lib/auth/perms'
import { writeAudit } from '@/lib/audit'
import { otterDb } from '@/lib/db/otter'
import { businesses } from '@/lib/db/schema/otter/businesses'
import { notes } from '@/lib/db/schema/otter/notes'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type RouteCtx = { params: Promise<{ slug: string; noteId: string }> }

async function handleDelete(
  _req: NextRequest,
  access: AccessMap,
  slug: string,
  noteId: string,
): Promise<Response> {
  // Resolve business by slug first — gives us the businessId we scope the
  // delete to (so a noteId from a different biz can't be deleted via a
  // forged slug) and lets us 404 cleanly when the slug is bogus.
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
        action: 'note.removed',
        targetType: 'notes',
        targetId: noteId,
        success: false,
        errorMessage: 'business-not-found',
        after: { slug },
      }).catch(() => {})
      return NextResponse.json({ error: 'not-found' }, { status: 404 })
    }
    businessId = found
  } catch (err) {
    console.warn('[api/otter/notes DELETE] business lookup failed', err)
    await writeAudit({
      bot: 'otter',
      actor: access.actor,
      viewing: access.viewing,
      action: 'note.removed',
      targetType: 'notes',
      targetId: noteId,
      success: false,
      errorMessage: err instanceof Error ? err.message : String(err),
      after: { slug, stage: 'business-lookup' },
    }).catch(() => {})
    return NextResponse.json({ error: 'db-error' }, { status: 500 })
  }

  // Load the note scoped to this business.
  let target: {
    id: string
    characterId: string
    characterName: string
    content: string
    authorDiscordId: string
    authorName: string
    visibility: 'staff' | 'manager' | 'owner'
  } | null = null
  try {
    const rows = await otterDb
      .select({
        id: notes.id,
        characterId: notes.characterId,
        characterName: notes.characterName,
        content: notes.content,
        authorDiscordId: notes.authorDiscordId,
        authorName: notes.authorName,
        visibility: notes.visibility,
      })
      .from(notes)
      .where(and(eq(notes.id, noteId), eq(notes.businessId, businessId)))
      .limit(1)
    target = rows[0] ?? null
  } catch (err) {
    console.warn('[api/otter/notes DELETE] note lookup failed', err)
    await writeAudit({
      bot: 'otter',
      actor: access.actor,
      viewing: access.viewing,
      action: 'note.removed',
      targetType: 'notes',
      targetId: noteId,
      success: false,
      errorMessage: err instanceof Error ? err.message : String(err),
      after: { slug, stage: 'note-lookup' },
    }).catch(() => {})
    return NextResponse.json({ error: 'db-error' }, { status: 500 })
  }

  if (!target) {
    await writeAudit({
      bot: 'otter',
      actor: access.actor,
      viewing: access.viewing,
      action: 'note.removed',
      targetType: 'notes',
      targetId: noteId,
      success: false,
      errorMessage: 'note-not-found',
      after: { slug },
    }).catch(() => {})
    return NextResponse.json({ error: 'not-found' }, { status: 404 })
  }

  const rank = access.otter.businesses[slug] ?? null
  const isAuthor = target.authorDiscordId === access.viewing.id
  const isBusinessOwner = rank === 'owner'
  const canDelete = access.botOwner || isAuthor || isBusinessOwner
  if (!canDelete) {
    await writeAudit({
      bot: 'otter',
      actor: access.actor,
      viewing: access.viewing,
      action: 'note.removed',
      targetType: 'notes',
      targetId: noteId,
      success: false,
      errorMessage: 'forbidden',
      after: {
        slug,
        authorDiscordId: target.authorDiscordId,
        rank,
      },
    }).catch(() => {})
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  try {
    await otterDb.delete(notes).where(eq(notes.id, noteId))
  } catch (err) {
    console.warn('[api/otter/notes DELETE] delete failed', err)
    await writeAudit({
      bot: 'otter',
      actor: access.actor,
      viewing: access.viewing,
      action: 'note.removed',
      targetType: 'notes',
      targetId: noteId,
      before: target,
      success: false,
      errorMessage: err instanceof Error ? err.message : String(err),
      after: { slug, stage: 'delete' },
    }).catch(() => {})
    return NextResponse.json({ error: 'db-error' }, { status: 500 })
  }

  await writeAudit({
    bot: 'otter',
    actor: access.actor,
    viewing: access.viewing,
    action: 'note.removed',
    targetType: 'notes',
    targetId: noteId,
    before: {
      characterId: target.characterId,
      characterName: target.characterName,
      visibility: target.visibility,
      authorDiscordId: target.authorDiscordId,
      authorName: target.authorName,
      contentLength: target.content.length,
      // Capture content so an accidental delete is reconstructable. Capped at
      // a reasonable size — the schema allows 4000 chars and JSON in details
      // shouldn't be unbounded.
      content: target.content.slice(0, 4000),
    },
    after: null,
    success: true,
    // `via` is forensic metadata only — channelled into the audit details so
    // we can see WHY a delete passed the gate (author vs owner vs bot-owner).
    errorMessage: undefined,
  }).catch((auditErr: unknown) => {
    console.warn('[api/otter/notes DELETE] audit write failed', auditErr)
  })

  return NextResponse.json({
    ok: true,
    id: noteId,
    via: isAuthor ? 'author' : isBusinessOwner ? 'business-owner' : 'bot-owner',
  })
}

export const DELETE = withAuth<[RouteCtx]>(
  async (req, access, ctx) => {
    const { slug, noteId } = await ctx.params
    return handleDelete(req, access, slug, noteId)
  },
  {
    require: 'any',
    csrf: true,
    rateLimit: { points: 30, perSeconds: 60 },
  },
)

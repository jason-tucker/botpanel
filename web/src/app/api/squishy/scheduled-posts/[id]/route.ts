/**
 * /api/squishy/scheduled-posts/[id]
 *
 *  - PATCH  partial edit of a not-yet-posted row (title / channelId / spec /
 *           variables / fireAt / enableRsvp). 409 once a row is posted —
 *           editing a live message would desync; cancel + recreate instead.
 *  - DELETE remove the row. If it was already posted, best-effort ask the bot
 *           to delete the live Discord message (`scheduled_post.cancel`) first
 *           so we don't leave an orphaned message with dead RSVP buttons.
 *
 * Gating: sudo. CSRF + 30/min rate limit. Audit on success AND failure.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { withAuth } from '@/lib/auth/middleware'
import { writeAudit } from '@/lib/audit'
import { squishyDb, squishySchema } from '@/lib/db/squishy'
import { callBot } from '@/lib/botrpc'
import { parseMessageSpec } from '@/lib/msgspec/schema'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SNOWFLAKE_RE = /^\d{15,25}$/
const MAX_TITLE = 120

type RawBody = {
  title?: unknown
  channelId?: unknown
  spec?: unknown
  variables?: unknown
  fireAt?: unknown
  enableRsvp?: unknown
}

function sanitizeVariables(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object') return {}
  const out: Record<string, unknown> = {}
  const o = raw as Record<string, unknown>
  if (typeof o.notes === 'string') out.notes = o.notes.slice(0, 2000)
  if (typeof o.eventAt === 'string' && Number.isFinite(Date.parse(o.eventAt))) out.eventAt = o.eventAt
  return out
}

export const PATCH = withAuth(
  async (req: NextRequest, access, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params
    const rowId = (id ?? '').trim()
    if (!UUID_RE.test(rowId)) {
      return NextResponse.json({ error: 'id must be a UUID' }, { status: 400 })
    }

    let body: RawBody
    try {
      body = ((await req.json()) ?? {}) as RawBody
    } catch {
      return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
    }

    const patch: Partial<typeof squishySchema.scheduledPosts.$inferInsert> = { updatedAt: new Date() }
    if (body.title !== undefined) {
      const t = typeof body.title === 'string' ? body.title.trim() : ''
      if (t.length === 0 || t.length > MAX_TITLE) return NextResponse.json({ error: `title must be 1-${MAX_TITLE} chars` }, { status: 400 })
      patch.title = t
    }
    if (body.channelId !== undefined) {
      const c = typeof body.channelId === 'string' ? body.channelId.trim() : ''
      if (!SNOWFLAKE_RE.test(c)) return NextResponse.json({ error: 'channelId must be a snowflake' }, { status: 400 })
      patch.channelId = c
    }
    if (body.spec !== undefined) {
      const r = parseMessageSpec(body.spec)
      if (!r.ok) return NextResponse.json({ error: `invalid message: ${r.errors[0] ?? 'bad spec'}`, errors: r.errors }, { status: 400 })
      patch.spec = r.spec
    }
    if (body.variables !== undefined) patch.variables = sanitizeVariables(body.variables)
    if (body.enableRsvp !== undefined) patch.enableRsvp = body.enableRsvp !== false
    if (body.fireAt !== undefined) {
      if (body.fireAt === null || body.fireAt === '') patch.fireAt = null
      else if (typeof body.fireAt === 'string' && Number.isFinite(Date.parse(body.fireAt))) patch.fireAt = new Date(body.fireAt)
      else return NextResponse.json({ error: 'fireAt must be an ISO datetime or null' }, { status: 400 })
    }

    if (Object.keys(patch).length <= 1) {
      return NextResponse.json({ error: 'no fields to patch' }, { status: 400 })
    }

    try {
      const existing = await squishyDb.select().from(squishySchema.scheduledPosts).where(eq(squishySchema.scheduledPosts.id, rowId))
      if (existing.length === 0) return NextResponse.json({ error: 'not found' }, { status: 404 })
      if (existing[0].status === 'posted' || existing[0].status === 'posting') {
        return NextResponse.json({ error: 'already posted — cancel and recreate to change a live post' }, { status: 409 })
      }

      // A scheduled-again edit clears any prior failure so it re-fires cleanly.
      if (existing[0].status === 'failed') {
        patch.status = 'scheduled'
        patch.error = null
      }

      const updated = await squishyDb
        .update(squishySchema.scheduledPosts)
        .set(patch)
        .where(eq(squishySchema.scheduledPosts.id, rowId))
        .returning()

      await writeAudit({
        bot: 'squishy',
        action: 'scheduled_post.updated',
        actor: access.actor,
        viewing: access.viewing,
        targetType: 'scheduled_posts',
        targetId: rowId,
        before: existing[0],
        after: updated[0],
        success: true,
      }).catch(() => {})

      return NextResponse.json({ ok: true, id: rowId, row: updated[0] })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown'
      console.error('[scheduled-posts PATCH] failed', err)
      await writeAudit({
        bot: 'squishy', action: 'scheduled_post.updated', actor: access.actor, viewing: access.viewing,
        targetType: 'scheduled_posts', targetId: rowId, success: false, errorMessage: msg,
      }).catch(() => {})
      return NextResponse.json({ error: 'db-write-failed' }, { status: 503 })
    }
  },
  { require: 'sudo', csrf: true, rateLimit: { points: 30, perSeconds: 60 } },
)

export const DELETE = withAuth(
  async (_req: NextRequest, access, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params
    const rowId = (id ?? '').trim()
    if (!UUID_RE.test(rowId)) {
      return NextResponse.json({ error: 'id must be a UUID' }, { status: 400 })
    }

    try {
      const existing = await squishyDb.select().from(squishySchema.scheduledPosts).where(eq(squishySchema.scheduledPosts.id, rowId))
      if (existing.length === 0) return NextResponse.json({ error: 'not found' }, { status: 404 })

      // Live post → ask the bot to remove the Discord message first (best-effort).
      if (existing[0].status === 'posted' && existing[0].messageId) {
        await callBot('squishy', 'scheduled_post.cancel', { id: rowId }).catch(() => {})
      }

      await squishyDb.delete(squishySchema.scheduledPosts).where(eq(squishySchema.scheduledPosts.id, rowId))

      await writeAudit({
        bot: 'squishy',
        action: 'scheduled_post.removed',
        actor: access.actor,
        viewing: access.viewing,
        targetType: 'scheduled_posts',
        targetId: rowId,
        before: existing[0],
        success: true,
      }).catch(() => {})

      return NextResponse.json({ ok: true, id: rowId })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown'
      console.error('[scheduled-posts DELETE] failed', err)
      await writeAudit({
        bot: 'squishy', action: 'scheduled_post.removed', actor: access.actor, viewing: access.viewing,
        targetType: 'scheduled_posts', targetId: rowId, success: false, errorMessage: msg,
      }).catch(() => {})
      return NextResponse.json({ error: 'db-delete-failed' }, { status: 503 })
    }
  },
  { require: 'sudo', csrf: true, rateLimit: { points: 30, perSeconds: 60 } },
)

/**
 * POST /api/squishy/scheduled-posts — create a scheduled / on-demand CV2 post.
 *
 * Body:
 *   {
 *     title: string,            // short label (e.g. game name) — also {{game}}
 *     channelId: string,        // Discord snowflake of the target channel
 *     spec: MessageSpec,        // the embed editor's portable message spec
 *     variables?: object,       // static vars; { notes?, eventAt? (ISO) }
 *     fireAt?: string | null,   // ISO instant to auto-post; null = manual only
 *     enableRsvp?: boolean,     // game-night RSVP buttons (default true)
 *     sendNow?: boolean,        // also post immediately via the bot
 *   }
 *
 * The panel owns the row (direct Drizzle insert); the bot's scheduler polls the
 * table for due rows, so a scheduled post survives a panel restart. "Send now"
 * additionally fires `scheduled_post.send` for instant feedback — the DB stays
 * authoritative if the RPC times out.
 *
 * Gating: sudo. CSRF + 20/min rate limit via the wrapper. Audit on every path.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { withAuth } from '@/lib/auth/middleware'
import { writeAudit } from '@/lib/audit'
import { squishyDb, squishySchema } from '@/lib/db/squishy'
import { env } from '@/lib/env'
import { callBot } from '@/lib/botrpc'
import { parseMessageSpec } from '@/lib/msgspec/schema'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SNOWFLAKE_RE = /^\d{15,25}$/
const MAX_TITLE = 120

type RawBody = {
  title?: unknown
  channelId?: unknown
  spec?: unknown
  variables?: unknown
  fireAt?: unknown
  enableRsvp?: unknown
  sendNow?: unknown
}

function parseFireAt(raw: unknown): { ok: true; value: Date | null } | { ok: false } {
  if (raw === undefined || raw === null || raw === '') return { ok: true, value: null }
  if (typeof raw !== 'string') return { ok: false }
  const ms = Date.parse(raw)
  if (!Number.isFinite(ms)) return { ok: false }
  return { ok: true, value: new Date(ms) }
}

function sanitizeVariables(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object') return {}
  const out: Record<string, unknown> = {}
  const o = raw as Record<string, unknown>
  if (typeof o.notes === 'string') out.notes = o.notes.slice(0, 2000)
  if (typeof o.eventAt === 'string' && Number.isFinite(Date.parse(o.eventAt))) out.eventAt = o.eventAt
  return out
}

export const POST = withAuth(
  async (req: NextRequest, access) => {
    const audit = (success: boolean, errorMessage?: string, targetId?: string, after?: unknown) =>
      writeAudit({
        bot: 'squishy',
        action: 'scheduled_post.created',
        actor: access.actor,
        viewing: access.viewing,
        targetType: 'scheduled_posts',
        targetId: targetId ?? null,
        after,
        success,
        errorMessage: errorMessage ?? null,
      }).catch(() => {})

    let body: RawBody
    try {
      body = ((await req.json()) ?? {}) as RawBody
    } catch {
      await audit(false, 'invalid-json')
      return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
    }

    const title = typeof body.title === 'string' ? body.title.trim() : ''
    if (title.length === 0 || title.length > MAX_TITLE) {
      return NextResponse.json({ error: `title must be 1-${MAX_TITLE} chars` }, { status: 400 })
    }

    const channelId = typeof body.channelId === 'string' ? body.channelId.trim() : ''
    if (!SNOWFLAKE_RE.test(channelId)) {
      return NextResponse.json({ error: 'channelId must be a Discord snowflake' }, { status: 400 })
    }

    const specResult = parseMessageSpec(body.spec)
    if (!specResult.ok) {
      return NextResponse.json({ error: `invalid message: ${specResult.errors[0] ?? 'bad spec'}`, errors: specResult.errors }, { status: 400 })
    }

    const fire = parseFireAt(body.fireAt)
    if (!fire.ok) {
      return NextResponse.json({ error: 'fireAt must be an ISO datetime or null' }, { status: 400 })
    }

    if (!env.GUILD_ID) {
      await audit(false, 'GUILD_ID-unset')
      return NextResponse.json({ error: 'GUILD_ID is not configured' }, { status: 500 })
    }

    const enableRsvp = body.enableRsvp !== false
    const variables = sanitizeVariables(body.variables)
    const sendNow = body.sendNow === true

    try {
      const inserted = await squishyDb
        .insert(squishySchema.scheduledPosts)
        .values({
          guildId: env.GUILD_ID,
          channelId,
          kind: 'game_night',
          title,
          spec: specResult.spec,
          variables,
          fireAt: fire.value,
          enableRsvp,
          status: 'scheduled',
          createdByDiscordId: access.actor.id,
        })
        .returning()
      const row = inserted[0]

      await audit(true, undefined, row.id, { title, channelId, fireAt: fire.value, enableRsvp, sendNow })

      let sent: { ok: boolean; error?: string; messageId?: string } = { ok: false }
      if (sendNow) {
        const reply = await callBot<{ messageId?: string; channelId?: string }>('squishy', 'scheduled_post.send', { id: row.id })
        sent = reply.ok ? { ok: true, messageId: reply.data?.messageId } : { ok: false, error: reply.error }
      }

      return NextResponse.json({ ok: true, id: row.id, row, sent }, { status: 201 })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown'
      console.error('[scheduled-posts POST] db write failed', err)
      await audit(false, msg)
      return NextResponse.json({ error: 'db-write-failed' }, { status: 503 })
    }
  },
  { require: 'sudo', csrf: true, rateLimit: { points: 20, perSeconds: 60 } },
)

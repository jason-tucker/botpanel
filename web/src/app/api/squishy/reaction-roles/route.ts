/**
 * POST /api/squishy/reaction-roles — build a new reaction-role message.
 *
 * The existing read flow (`page.tsx` `loadReactionMessages`) stays on
 * the server component / Drizzle path. This route is write-only and
 * delegates to the bot via `callBot('squishy', 'rxnroles.create', ...)`
 * because creating one means posting a Discord message — DB-only would
 * leave the rows pointing at nothing.
 *
 * Body shape (JSON):
 *   ```
 *   {
 *     channelId: string,                 // 15-25 digit Discord snowflake
 *     body: string,                      // message content; bot clamps at 2000
 *     mappings: Array<{ emoji: string,   // unicode or <:name:id> syntax
 *                       roleId: string }>,
 *     isTemporary?: boolean,
 *     expiresInMinutes?: number,         // required when isTemporary: 1..43200
 *   }
 *   ```
 *
 * Gating: `withAuth({require:'sudo', csrf:true, rateLimit:{points:10, perSeconds:60}})`.
 * Tighter than the auto-join / color routes (30/min) because each call
 * posts a real Discord message — a click-spammed form mustn't carpet-
 * bomb the channel.
 *
 * On success returns `{ ok: true, messageId, channelId }` so the client
 * can router.push to the read-only tab and re-render. On RPC failure
 * returns 502 with the bot's error code in the body — the in-form
 * banner surfaces it verbatim so an operator can tell `send-failed`
 * from `bad-channel` etc.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { withAuth } from '@/lib/auth/middleware'
import { writeAudit } from '@/lib/audit'
import { callBot } from '@/lib/botrpc'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SNOWFLAKE_RE = /^\d{15,25}$/
const MIN_MAPPINGS = 1
const MAX_MAPPINGS = 20
const MAX_BODY_LEN = 2000
const MAX_EXPIRES_MIN = 60 * 24 * 30

type Mapping = { emoji: string; roleId: string }

type ParseResult =
  | {
      ok: true
      channelId: string
      body: string
      mappings: Mapping[]
      isTemporary: boolean
      expiresInMinutes?: number
    }
  | { ok: false; error: string }

function parseBody(raw: unknown): ParseResult {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'body must be a JSON object' }
  }
  const o = raw as Record<string, unknown>

  const channelId =
    typeof o.channelId === 'string' ? o.channelId.trim() : ''
  if (!SNOWFLAKE_RE.test(channelId)) {
    return { ok: false, error: 'channelId must be a Discord snowflake (15-25 digits)' }
  }

  const body = typeof o.body === 'string' ? o.body : ''
  if (body.trim() === '') {
    return { ok: false, error: 'body is required' }
  }
  if (body.length > MAX_BODY_LEN) {
    return { ok: false, error: `body too long (max ${MAX_BODY_LEN} chars)` }
  }

  if (!Array.isArray(o.mappings)) {
    return { ok: false, error: 'mappings must be an array' }
  }
  if (o.mappings.length < MIN_MAPPINGS || o.mappings.length > MAX_MAPPINGS) {
    return {
      ok: false,
      error: `mappings must contain ${MIN_MAPPINGS}..${MAX_MAPPINGS} entries`,
    }
  }
  const mappings: Mapping[] = []
  for (const m of o.mappings) {
    if (!m || typeof m !== 'object') {
      return { ok: false, error: 'each mapping must be {emoji, roleId}' }
    }
    const mm = m as Record<string, unknown>
    const emoji = typeof mm.emoji === 'string' ? mm.emoji.trim() : ''
    const roleId = typeof mm.roleId === 'string' ? mm.roleId.trim() : ''
    if (!emoji) return { ok: false, error: 'mapping.emoji is required' }
    if (!SNOWFLAKE_RE.test(roleId)) {
      return {
        ok: false,
        error: `mapping.roleId must be a Discord snowflake (got "${roleId}")`,
      }
    }
    mappings.push({ emoji, roleId })
  }

  const isTemporary = Boolean(o.isTemporary)
  let expiresInMinutes: number | undefined
  if (isTemporary) {
    const n = Number(o.expiresInMinutes)
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n > MAX_EXPIRES_MIN) {
      return {
        ok: false,
        error: `expiresInMinutes must be an integer 1..${MAX_EXPIRES_MIN} when temporary`,
      }
    }
    expiresInMinutes = n
  }

  return { ok: true, channelId, body, mappings, isTemporary, expiresInMinutes }
}

export const POST = withAuth(
  async (req: NextRequest, access) => {
    let body: unknown
    try {
      body = await req.json()
    } catch {
      await writeAudit({
        bot: 'squishy',
        action: 'rxnroles.created',
        actor: access.actor,
        viewing: access.viewing,
        targetType: 'reaction_role_messages',
        success: false,
        errorMessage: 'invalid-json',
      }).catch(() => {})
      return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
    }

    const parsed = parseBody(body)
    if (!parsed.ok) {
      await writeAudit({
        bot: 'squishy',
        action: 'rxnroles.created',
        actor: access.actor,
        viewing: access.viewing,
        targetType: 'reaction_role_messages',
        success: false,
        errorMessage: parsed.error,
      }).catch(() => {})
      return NextResponse.json({ error: parsed.error }, { status: 400 })
    }

    // Hand off to the bot. Slightly longer timeout than the default —
    // creating a reaction-role message means posting the message AND
    // seeding up to 20 reactions, each its own discord.js round-trip.
    const reply = await callBot<{ messageId: string; channelId: string }>(
      'squishy',
      'rxnroles.create',
      {
        channelId: parsed.channelId,
        body: parsed.body,
        mappings: parsed.mappings,
        isTemporary: parsed.isTemporary,
        expiresInMinutes: parsed.expiresInMinutes,
      },
      { timeoutMs: 15_000 },
    )

    if (!reply.ok) {
      await writeAudit({
        bot: 'squishy',
        action: 'rxnroles.created',
        actor: access.actor,
        viewing: access.viewing,
        targetType: 'reaction_role_messages',
        before: null,
        after: {
          channelId: parsed.channelId,
          mappingCount: parsed.mappings.length,
          isTemporary: parsed.isTemporary,
          expiresInMinutes: parsed.expiresInMinutes ?? null,
        },
        success: false,
        errorMessage: reply.error,
      }).catch(() => {})
      // 502 — we got a structured failure from the downstream (bot)
      // service. The reply.error code propagates verbatim so the form
      // banner can show e.g. "bad-channel" or "send-failed".
      return NextResponse.json(
        { error: reply.error, details: reply.details ?? null },
        { status: 502 },
      )
    }

    await writeAudit({
      bot: 'squishy',
      action: 'rxnroles.created',
      actor: access.actor,
      viewing: access.viewing,
      targetType: 'reaction_role_messages',
      targetId: reply.data.messageId,
      before: null,
      after: {
        channelId: reply.data.channelId,
        messageId: reply.data.messageId,
        mappingCount: parsed.mappings.length,
        isTemporary: parsed.isTemporary,
        expiresInMinutes: parsed.expiresInMinutes ?? null,
      },
      success: true,
    }).catch((err) => {
      console.warn('[reaction-roles POST] audit write failed', err)
    })

    return NextResponse.json(
      {
        ok: true,
        messageId: reply.data.messageId,
        channelId: reply.data.channelId,
      },
      { status: 201 },
    )
  },
  {
    require: 'sudo',
    csrf: true,
    // Tight: each call posts a real Discord message + up to 20 reaction
    // adds. Click-spam can't carpet-bomb the channel.
    rateLimit: { points: 10, perSeconds: 60 },
  },
)

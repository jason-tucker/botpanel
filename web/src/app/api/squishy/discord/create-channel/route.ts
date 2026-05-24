/**
 * POST /api/squishy/discord/create-channel — create a Discord channel on
 * the configured guild via the bot's `discord.create_channel` RPC verb.
 *
 * Body: `{ name, type: 'text'|'voice'|'announcement'|'forum', parentId?,
 *         position?, topic? }`.
 *
 * Driven by the panel's "+ Create" inline button next to an unset channel
 * link in the games editor. Panel prompts for the channel name, posts to
 * this route with `type:'text'` + `parentId` from the games-category bot
 * setting, then PATCHes the games row with the returned channel ID.
 *
 * Gating: sudo, CSRF, 10/min — see create-role/route.ts for the rationale.
 *
 * Audit action: `discord.channel_created`.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { withAuth } from '@/lib/auth/middleware'
import { writeAudit } from '@/lib/audit'
import { callBot } from '@/lib/botrpc'
import { checkGamesWriteGuildLimits } from '@/lib/limits/gamesProvision'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SNOWFLAKE_RE = /^\d{15,25}$/
const MAX_NAME_LEN = 100
const MAX_TOPIC_LEN = 1024
const VALID_TYPES = new Set(['text', 'voice', 'announcement', 'forum'] as const)
type ChannelType = 'text' | 'voice' | 'announcement' | 'forum'

type Body = {
  name?: unknown
  type?: unknown
  parentId?: unknown
  position?: unknown
  topic?: unknown
}

function parseSnowflake(raw: unknown): { ok: true; value: string | undefined } | { ok: false } {
  if (raw === undefined || raw === null || raw === '') return { ok: true, value: undefined }
  if (typeof raw !== 'string') return { ok: false }
  const t = raw.trim()
  if (t === '') return { ok: true, value: undefined }
  if (!SNOWFLAKE_RE.test(t)) return { ok: false }
  return { ok: true, value: t }
}

function parsePosition(raw: unknown): { ok: true; value: number | undefined } | { ok: false } {
  if (raw === undefined || raw === null || raw === '') return { ok: true, value: undefined }
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > 1000) return { ok: false }
  return { ok: true, value: n }
}

export const POST = withAuth(
  async (req: NextRequest, access) => {
    let body: Body
    try {
      body = ((await req.json()) ?? {}) as Body
    } catch {
      return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
    }

    const rawName = typeof body.name === 'string' ? body.name.trim() : ''
    if (rawName.length === 0 || rawName.length > MAX_NAME_LEN) {
      return NextResponse.json(
        { error: `name must be 1-${MAX_NAME_LEN} chars` },
        { status: 400 },
      )
    }

    if (typeof body.type !== 'string' || !VALID_TYPES.has(body.type as ChannelType)) {
      return NextResponse.json(
        { error: `type must be one of: ${[...VALID_TYPES].join(', ')}` },
        { status: 400 },
      )
    }
    const type = body.type as ChannelType

    const parentParse = parseSnowflake(body.parentId)
    if (!parentParse.ok) {
      return NextResponse.json(
        { error: 'parentId must be a Discord snowflake (15-25 digits)' },
        { status: 400 },
      )
    }

    const posParse = parsePosition(body.position)
    if (!posParse.ok) {
      return NextResponse.json({ error: 'position must be an integer 0..1000' }, { status: 400 })
    }

    let topic: string | undefined
    if (body.topic !== undefined && body.topic !== null && body.topic !== '') {
      if (typeof body.topic !== 'string') {
        return NextResponse.json({ error: 'topic must be a string' }, { status: 400 })
      }
      if (body.topic.length > MAX_TOPIC_LEN) {
        return NextResponse.json(
          { error: `topic must be ≤ ${MAX_TOPIC_LEN} chars` },
          { status: 400 },
        )
      }
      topic = body.topic
    }

    // Per-guild ceiling shared with create-role / games-provision. See
    // #226 + lib/limits/gamesProvision.ts.
    const guildLimit = checkGamesWriteGuildLimits()
    if (!guildLimit.ok) {
      return NextResponse.json(
        { error: guildLimit.error, retryAfter: guildLimit.retryAfterSec },
        { status: 429, headers: { 'Retry-After': String(guildLimit.retryAfterSec) } },
      )
    }

    const reply = await callBot('squishy', 'discord.create_channel', {
      name: rawName,
      type,
      parentId: parentParse.value,
      position: posParse.value,
      topic,
    })

    if (!reply.ok) {
      await writeAudit({
        bot: 'squishy',
        action: 'discord.channel_created',
        actor: access.actor,
        viewing: access.viewing,
        targetType: 'discord_channel',
        before: null,
        after: { name: rawName, type, parentId: parentParse.value, position: posParse.value },
        success: false,
        errorMessage: reply.error,
      }).catch(() => {})
      const status = reply.error === 'timeout' || reply.error === 'rpc-not-configured'
        ? 503
        : reply.error === 'missing-permissions' ? 403 : 400
      return NextResponse.json({ error: reply.error, details: reply.details }, { status })
    }

    const data = (reply.data ?? {}) as {
      id?: string
      name?: string
      type?: ChannelType
      parentId?: string | null
      position?: number
    }

    await writeAudit({
      bot: 'squishy',
      action: 'discord.channel_created',
      actor: access.actor,
      viewing: access.viewing,
      targetType: 'discord_channel',
      targetId: data.id ?? null,
      before: null,
      after: data,
      success: true,
    }).catch(() => {})

    return NextResponse.json({ ok: true, data }, { status: 201 })
  },
  {
    require: 'sudo',
    csrf: true,
    rateLimit: { points: 10, perSeconds: 60 },
  },
)

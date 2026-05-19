/**
 * POST /api/squishy/play — panel-triggered LFG post.
 *
 * Mirrors the squishybot `/play <game> [message] [ping]` slash command,
 * driven from the panel. The bot owns the CV2 panel + button handlers
 * (Help, Notify Toggle, I-want-to-play, Cancel); we just call the
 * `play.post` RPC verb with the panel actor as host.
 *
 * Host attribution: `access.viewing.id` so View-As surfaces correctly
 * (sudo can post "as" the impersonated user; the audit row captures
 * both `actor` and `viewing`).
 *
 * Gating: `withAuth({ require: 'any' })` — everyone with a session can
 * post LFG, same as the slash command. CSRF + 5 req / 60s per actor
 * because each call ends up posting a real Discord message + (optional)
 * role ping; the bot also enforces a per-(user,game) 30 min cooldown.
 *
 * Audit: `squishy.play_posted` with `{ gameId, hasMessage, ping }` in
 * `after`. Message text is intentionally NOT logged — it's free-form
 * user content that often contains other users' names; the audit table
 * shouldn't be a reflection of every LFG body ever posted.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { withAuth } from '@/lib/auth/middleware'
import { callBot } from '@/lib/botrpc'
import { writeAudit } from '@/lib/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_MESSAGE_LEN = 500

type Body = {
  gameId?: unknown
  message?: unknown
  ping?: unknown
}

function parseBody(body: Body): { ok: true; gameId: string; message?: string; ping: boolean } | { ok: false; error: string } {
  const gameId = typeof body.gameId === 'string' ? body.gameId.trim() : ''
  if (gameId.length === 0) return { ok: false, error: 'gameId required' }
  let message: string | undefined
  if (body.message !== undefined && body.message !== null && body.message !== '') {
    if (typeof body.message !== 'string') return { ok: false, error: 'message must be a string' }
    const trimmed = body.message.trim()
    if (trimmed.length > MAX_MESSAGE_LEN) return { ok: false, error: `message must be <= ${MAX_MESSAGE_LEN} chars` }
    message = trimmed || undefined
  }
  let ping = true
  if (body.ping !== undefined && body.ping !== null) {
    if (typeof body.ping !== 'boolean') return { ok: false, error: 'ping must be a boolean' }
    ping = body.ping
  }
  return { ok: true, gameId, message, ping }
}

type RpcReply = {
  channelId?: string
  messageId?: string
}

export const POST = withAuth(
  async (req: NextRequest, access) => {
    let raw: Body
    try {
      raw = ((await req.json()) ?? {}) as Body
    } catch {
      return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
    }
    const parsed = parseBody(raw)
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 })
    }

    const reply = await callBot<RpcReply>('squishy', 'play.post', {
      gameId: parsed.gameId,
      hostUserId: access.viewing.id,
      message: parsed.message,
      ping: parsed.ping,
      // Always enforce cooldown from the panel — sudo-via-slash bypasses
      // it via in-process `isSudo(member)`, but the panel is the wrong
      // place to override that gate; keeps the 30-min cap intact.
      enforceCooldown: true,
    })

    if (!reply.ok) {
      await writeAudit({
        bot: 'squishy',
        action: 'squishy.play_posted',
        targetType: 'games',
        targetId: parsed.gameId,
        actor: access.actor, viewing: access.viewing,
        before: null,
        after: { hasMessage: !!parsed.message, ping: parsed.ping },
        success: false,
        errorMessage: reply.error,
      }).catch(() => {})
      // Map bot-side error tokens to friendly HTTP statuses; pass the
      // token through verbatim so the client can localize.
      const status =
        reply.error === 'timeout' || reply.error === 'rpc-not-configured' ? 503
        : reply.error === 'cooldown' ? 429
        : reply.error === 'bot-missing-perm' ? 403
        : reply.error === 'game-not-found' || reply.error === 'game-no-channel' || reply.error === 'channel-unreachable' || reply.error === 'channel-not-text' ? 404
        : 400
      return NextResponse.json({ error: reply.error, details: reply.details, remainingSec: (reply as unknown as { remainingSec?: number }).remainingSec }, { status })
    }

    const data = reply.data ?? {}
    await writeAudit({
      bot: 'squishy',
      action: 'squishy.play_posted',
      targetType: 'games',
      targetId: parsed.gameId,
      actor: access.actor, viewing: access.viewing,
      before: null,
      after: { hasMessage: !!parsed.message, ping: parsed.ping, channelId: data.channelId, messageId: data.messageId },
      success: true,
    }).catch(() => {})

    return NextResponse.json({ ok: true, data }, { status: 201 })
  },
  {
    require: 'any',
    csrf: true,
    rateLimit: { points: 5, perSeconds: 60 },
  },
)

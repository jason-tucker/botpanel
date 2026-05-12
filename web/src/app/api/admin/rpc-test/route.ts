/**
 * POST /api/admin/rpc-test — bot-owner-only smoke test for the command bus.
 *
 * Body: `{ bot: 'squishy' | 'otter', message: string }`.
 *
 * Calls `callBot(bot, 'echo', { message })` and returns the bot's reply
 * verbatim — `{ ok: true, data }` or `{ ok: false, error, details? }`. Used
 * by `/sudo/rpc-test` to verify Wave 7a (panel-side client) end-to-end
 * once the bot subscribers land. While the bots don't yet implement the
 * `echo` verb the response will be `{ ok: false, error: 'timeout' }` —
 * that's the correct signal (panel did its half; the bot side hasn't
 * landed yet).
 *
 * NOT audited via `writeAudit` — this is a read-only diagnostic. Real
 * RPC verbs (Wave 7b+) audit at the per-route layer, not here.
 *
 * Rate-limited (10/min/actor) so a stuck refresh doesn't hammer the
 * bus during operator triage.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { withAuth } from '@/lib/auth/middleware'
import { callBot, type BotName } from '@/lib/botrpc'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BOTS: ReadonlySet<BotName> = new Set(['squishy', 'otter'])

export const POST = withAuth(
  async (req: NextRequest) => {
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
    }

    const b = body as { bot?: unknown; message?: unknown } | null
    const bot = b?.bot
    const message = b?.message

    if (typeof bot !== 'string' || !BOTS.has(bot as BotName)) {
      return NextResponse.json(
        { error: 'bot must be "squishy" or "otter"' },
        { status: 400 },
      )
    }
    if (typeof message !== 'string' || message.length === 0 || message.length > 500) {
      return NextResponse.json(
        { error: 'message must be a non-empty string ≤ 500 chars' },
        { status: 400 },
      )
    }

    const reply = await callBot(bot as BotName, 'echo', { message })
    // Always return 200 — the reply itself carries `ok: true|false`. The
    // UI inspects that flag rather than HTTP status so it can render
    // a friendly error message for `timeout` / `rpc-not-configured` /
    // etc. instead of a generic "request failed".
    return NextResponse.json({ reply })
  },
  {
    require: 'botOwner',
    csrf: true,
    rateLimit: { points: 10, perSeconds: 60 },
  },
)

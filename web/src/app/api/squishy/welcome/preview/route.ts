/**
 * POST /api/squishy/welcome/preview — render the current welcome/goodbye
 * template via the bot's `welcome.preview` RPC verb.
 *
 * Body: `{ kind: 'welcome' | 'goodbye' }`.
 *
 * Gate: sudo (`access.squishy.sudo || access.botOwner`). The panel page at
 * `/squishy/welcome` is the only caller — same surface, same audience.
 *
 * Behaviour: forwards to `callBot('squishy', 'welcome.preview',
 * { userId: access.viewing.id, kind })` and returns the reply verbatim
 * under `{ reply }`. The verb is **read-only** on the bot side — it
 * renders the template using the live `bot_settings` values and returns
 * the rendered string. It does NOT post to the welcome/goodbye channel;
 * that's still owned by the live `guildMemberAdd` / `guildMemberRemove`
 * event handlers.
 *
 * NOT audited via `writeAudit` — there's no DB mutation here, just a
 * read-only render call. The settings PUT endpoints (already in place)
 * audit the actual config writes; this route only previews them.
 *
 * Rate-limit: 10/min/actor — same shape as `/api/admin/rpc-test`, since
 * each call hits the bot via the command bus and we don't want a stuck
 * panel tab to hammer it.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { withAuth } from '@/lib/auth/middleware'
import { callBot } from '@/lib/botrpc'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Kind = 'welcome' | 'goodbye'
const KINDS: ReadonlySet<Kind> = new Set(['welcome', 'goodbye'])

export const POST = withAuth(
  async (req: NextRequest, access) => {
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
    }

    const kind = (body as { kind?: unknown } | null)?.kind
    if (typeof kind !== 'string' || !KINDS.has(kind as Kind)) {
      return NextResponse.json(
        { error: "kind must be 'welcome' or 'goodbye'" },
        { status: 400 },
      )
    }

    const reply = await callBot('squishy', 'welcome.preview', {
      userId: access.viewing.id,
      kind,
    })
    // Always 200 — the inline `reply.ok` flag carries success/failure.
    // The page renders `timeout` / `rpc-not-configured` etc. as friendly
    // notices rather than HTTP errors so the operator can read them.
    return NextResponse.json({ reply })
  },
  {
    require: 'sudo',
    csrf: true,
    rateLimit: { points: 10, perSeconds: 60 },
  },
)

/**
 * POST /api/sudo/admin/reload-caches — bot-owner only.
 *
 * Calls `callBot('squishy', 'admin.reload_caches', {})` and returns the
 * bot's reply as the JSON body so the client can render the green inline
 * result strip (or a red one on `ok:false`). Always responds with HTTP 200
 * carrying the `{ok, ...}` envelope — the panel inspects the flag, not the
 * HTTP code, mirroring `/api/admin/rpc-test`.
 *
 * Audit: `admin.caches_reloaded` (bot=squishy). `after` carries the bot's
 * `data.reloaded` list on success, the error string on failure. The audit
 * landing site is console-only today (Squishy's `setting_changes` table is
 * for settings only) — that's still useful for `docker logs` triage.
 *
 * Rate limit: 5/min/actor. These are heavy ops; an operator clicking
 * the button 5x in a minute is the practical worst case.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { withAuth } from '@/lib/auth/middleware'
import { callBot } from '@/lib/botrpc'
import { writeAudit } from '@/lib/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = withAuth(
  async (_req: NextRequest, access) => {
    const reply = await callBot<{ reloaded: string[] }>('squishy', 'admin.reload_caches', {})

    await writeAudit({
      bot: 'squishy',
      action: 'admin.caches_reloaded',
      targetType: 'rpc',
      targetId: 'admin.reload_caches',
      actor: access.actor,
      viewing: access.viewing,
      before: null,
      after: reply.ok ? reply.data : null,
      success: reply.ok,
      errorMessage: reply.ok ? null : reply.error,
    }).catch(() => {
      // Best-effort. writeAudit already guards, but a chained `.catch` here
      // means an unexpected throw can't sink the response either.
    })

    return NextResponse.json({ reply })
  },
  {
    require: 'botOwner',
    csrf: true,
    rateLimit: { points: 5, perSeconds: 60 },
  },
)

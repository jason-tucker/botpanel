/**
 * POST /api/sudo/admin/reconciler — bot-owner only.
 *
 * Calls `callBot('squishy', 'admin.reconciler_run', {})` and returns the
 * bot's reply (the existing `ReconcilerResult` shape:
 * `{recovered, cleaned, hubs, panels, adopted}`) under `{reply}`.
 *
 * This is the heaviest of the three admin verbs — the reconciler walks
 * every `auto_channels` row, syncs perms, rebuilds control panels, etc.
 * The UI confirms via `confirm:` on the `<ServerForm>` before submit so
 * a fat-finger click doesn't fan out a hundred REST calls.
 *
 * Rate limit: 5/min/actor — same as the other two for consistency, and
 * because the bot-side reconciler is the actual bottleneck if it's
 * spammed (each run is ~seconds depending on guild size).
 */
import { NextResponse, type NextRequest } from 'next/server'
import { withAuth } from '@/lib/auth/middleware'
import { callBot } from '@/lib/botrpc'
import { writeAudit } from '@/lib/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type ReconcilerResult = {
  recovered: number
  cleaned: number
  hubs: number
  panels: number
  adopted: number
}

export const POST = withAuth(
  async (_req: NextRequest, access) => {
    const reply = await callBot<ReconcilerResult>('squishy', 'admin.reconciler_run', {})

    await writeAudit({
      bot: 'squishy',
      action: 'admin.reconciler_run',
      targetType: 'rpc',
      targetId: 'admin.reconciler_run',
      actor: access.actor,
      viewing: access.viewing,
      before: null,
      // Full result stats go into `after` so a "what did this run touch?"
      // question is answerable from the audit trail alone (vs. the orphan
      // scan where the full list would be unbounded).
      after: reply.ok ? reply.data : null,
      success: reply.ok,
      errorMessage: reply.ok ? null : reply.error,
    }).catch(() => {})

    return NextResponse.json({ reply })
  },
  {
    require: 'botOwner',
    csrf: true,
    rateLimit: { points: 5, perSeconds: 60 },
  },
)

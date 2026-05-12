/**
 * POST /api/sudo/admin/orphan-scan — bot-owner only.
 *
 * Calls `callBot('squishy', 'admin.orphan_scan', {})` and pipes the reply
 * back as `{reply}` so the page client can render the orphan list as a
 * table below the button row.
 *
 * Read-only verb on the bot side — does NOT delete. We still audit because
 * a scan reveals which DB rows reference dead Discord entities, which is
 * useful triage context even though no state changed.
 *
 * Rate limit: 5/min/actor. The scan walks five tables + queries
 * `guild.channels.cache` repeatedly; not free, but cheap enough that the
 * tight limit is about protecting the bot's command-bus pipeline rather
 * than the scan itself.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { withAuth } from '@/lib/auth/middleware'
import { callBot } from '@/lib/botrpc'
import { writeAudit } from '@/lib/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Orphan = { table: string; id: string; reason: string }

export const POST = withAuth(
  async (_req: NextRequest, access) => {
    const reply = await callBot<{ orphans: Orphan[] }>('squishy', 'admin.orphan_scan', {})

    await writeAudit({
      bot: 'squishy',
      action: 'admin.orphan_scan_run',
      targetType: 'rpc',
      targetId: 'admin.orphan_scan',
      actor: access.actor,
      viewing: access.viewing,
      before: null,
      // Capture the orphan COUNT in the audit row rather than the full
      // list — full list goes in the reply for the UI, audit only needs
      // "what did this scan find?" as a coarse number.
      after: reply.ok ? { orphanCount: reply.data.orphans.length } : null,
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

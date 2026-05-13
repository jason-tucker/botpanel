/**
 * POST /api/sudo/admin/orphan-cleanup — bot-owner only.
 *
 * Calls `callBot('squishy', 'admin.orphan_cleanup', {})` and returns the
 * bot's reply (`{deleted, byTable: {auto_channels, hub_channels,
 * auto_thread_channels, archived_channels}}`) under `{reply}`.
 *
 * Companion to `/api/sudo/admin/orphan-scan` (read-only walk): scan
 * shows what's orphaned, this deletes the entirely-orphan rows. Rows
 * with PARTIALLY-missing references are left alone (the bot decides;
 * the panel just triggers).
 *
 * Rate limit: 5/min/actor — matches the other admin verbs.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { withAuth } from '@/lib/auth/middleware'
import { callBot } from '@/lib/botrpc'
import { writeAudit } from '@/lib/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type CleanupResult = {
  deleted: number
  byTable: Record<string, number>
}

export const POST = withAuth(
  async (_req: NextRequest, access) => {
    const reply = await callBot<CleanupResult>('squishy', 'admin.orphan_cleanup', {})

    await writeAudit({
      bot: 'squishy',
      action: 'admin.orphan_cleanup',
      targetType: 'rpc',
      targetId: 'admin.orphan_cleanup',
      actor: access.actor,
      viewing: access.viewing,
      before: null,
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

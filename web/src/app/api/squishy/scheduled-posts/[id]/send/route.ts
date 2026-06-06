/**
 * POST /api/squishy/scheduled-posts/[id]/send — post a stored row immediately.
 *
 * Thin wrapper over the bot's `scheduled_post.send` verb (the bot renders +
 * sends + flips the row to 'posted'). Used by the "Send now" button on both
 * fresh and already-scheduled rows. DB stays authoritative if the RPC fails.
 *
 * Gating: sudo. CSRF + 20/min rate limit. Audit on every path.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { withAuth } from '@/lib/auth/middleware'
import { writeAudit } from '@/lib/audit'
import { callBot } from '@/lib/botrpc'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const POST = withAuth(
  async (_req: NextRequest, access, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params
    const rowId = (id ?? '').trim()
    if (!UUID_RE.test(rowId)) {
      return NextResponse.json({ error: 'id must be a UUID' }, { status: 400 })
    }

    const reply = await callBot<{ messageId?: string; channelId?: string }>('squishy', 'scheduled_post.send', { id: rowId })

    await writeAudit({
      bot: 'squishy',
      action: 'scheduled_post.sent',
      actor: access.actor,
      viewing: access.viewing,
      targetType: 'scheduled_posts',
      targetId: rowId,
      after: reply,
      success: reply.ok,
      errorMessage: reply.ok ? null : reply.error,
    }).catch(() => {})

    if (!reply.ok) {
      return NextResponse.json({ error: reply.error }, { status: 502 })
    }
    return NextResponse.json({ ok: true, id: rowId, messageId: reply.data?.messageId, channelId: reply.data?.channelId })
  },
  { require: 'sudo', csrf: true, rateLimit: { points: 20, perSeconds: 60 } },
)

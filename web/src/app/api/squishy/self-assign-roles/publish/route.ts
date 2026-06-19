/**
 * POST /api/squishy/self-assign-roles/publish — (re-)publish the self-assign
 * board.
 *
 * No body required. Delegates to `callBot('squishy','selfassign.publish',{})`.
 * The bot posts/updates each enabled entry as its own message in the configured
 * channel and deletes messages for disabled or removed entries.
 *
 * Returns `{ ok:true, posted:number, removed:number, channelId:string|null }`.
 *
 * Gating: sudo, CSRF. Tight rate-limit (10/min) because each publish call
 * may post many Discord messages.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { withAuth } from '@/lib/auth/middleware'
import { writeAudit } from '@/lib/audit'
import { callBot } from '@/lib/botrpc'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = withAuth(
  async (_req: NextRequest, access) => {
    const reply = await callBot<{
      posted: number
      removed: number
      channelId: string | null
    }>('squishy', 'selfassign.publish', {}, { timeoutMs: 15_000 })

    if (!reply.ok) {
      await writeAudit({
        bot: 'squishy',
        action: 'selfassign.published',
        actor: access.actor,
        viewing: access.viewing,
        targetType: 'self_assign_entries',
        success: false,
        errorMessage: reply.error,
      }).catch(() => {})
      return NextResponse.json(
        { error: reply.error, details: reply.details ?? null },
        { status: 502 },
      )
    }

    await writeAudit({
      bot: 'squishy',
      action: 'selfassign.published',
      actor: access.actor,
      viewing: access.viewing,
      targetType: 'self_assign_entries',
      before: null,
      after: {
        posted: reply.data.posted,
        removed: reply.data.removed,
        channelId: reply.data.channelId,
      },
      success: true,
    }).catch((err) => {
      console.warn('[self-assign-roles/publish POST] audit write failed', err)
    })

    return NextResponse.json({
      ok: true,
      posted: reply.data.posted,
      removed: reply.data.removed,
      channelId: reply.data.channelId,
    })
  },
  {
    require: 'sudo',
    csrf: true,
    rateLimit: { points: 10, perSeconds: 60 },
  },
)

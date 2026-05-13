/**
 * POST /api/otter/move-channel — gated to manager+ of any active business
 * (or sudo). Mirrors the `/movechannel` slash command's authorization
 * exactly (`commands/moveChannel.ts:53-65`).
 *
 * Body: `{ channelId, categoryId, position: 'top'|'bottom' }`.
 * Calls `callBot('otter', 'discord.move_channel', ...)`.
 *
 * Audited as `discord.channel_moved` with the before/after category names
 * in the audit payload so the trail captures what moved where.
 *
 * Rate limit: 10/min/actor — channel moves are infrequent operationally
 * but a stuck submit shouldn't flood the bot.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { withAuth } from '@/lib/auth/middleware'
import { callBot } from '@/lib/botrpc'
import { writeAudit } from '@/lib/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SNOWFLAKE = /^\d{15,25}$/

type MoveResult = {
  channelId: string
  channelName: string
  fromCategoryName: string | null
  toCategoryName: string
  position: 'top' | 'bottom'
}

export const POST = withAuth(
  async (req: NextRequest, access) => {
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
    }

    const b = body as
      | { channelId?: unknown; categoryId?: unknown; position?: unknown }
      | null
    const channelId = typeof b?.channelId === 'string' ? b.channelId : ''
    const categoryId = typeof b?.categoryId === 'string' ? b.categoryId : ''
    const position = b?.position === 'top' ? 'top' : b?.position === 'bottom' ? 'bottom' : null

    if (!SNOWFLAKE.test(channelId)) {
      return NextResponse.json({ error: 'invalid-channel-id' }, { status: 400 })
    }
    if (!SNOWFLAKE.test(categoryId)) {
      return NextResponse.json({ error: 'invalid-category-id' }, { status: 400 })
    }
    if (position === null) {
      return NextResponse.json({ error: 'invalid-position' }, { status: 400 })
    }

    // Authorization: manager+ of at least one active otter business, or sudo
    // (bot-owner implicit). Matches the slash command's gate.
    const isManagerSomewhere = Object.values(access.otter.businesses).some(
      (rank) => rank === 'manager' || rank === 'owner',
    )
    if (!isManagerSomewhere && !access.botOwner) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }

    const reply = await callBot<MoveResult>('otter', 'discord.move_channel', {
      channelId,
      categoryId,
      position,
    })

    await writeAudit({
      bot: 'otter',
      action: 'discord.channel_moved',
      targetType: 'channel',
      targetId: channelId,
      actor: access.actor,
      viewing: access.viewing,
      before: reply.ok
        ? { categoryName: reply.data.fromCategoryName }
        : null,
      after: reply.ok
        ? {
            categoryId,
            categoryName: reply.data.toCategoryName,
            position,
          }
        : null,
      success: reply.ok,
      errorMessage: reply.ok ? null : reply.error,
    }).catch(() => {})

    if (!reply.ok) {
      const status =
        reply.error === 'timeout' || reply.error === 'rpc-not-configured' ? 503 : 400
      return NextResponse.json({ error: reply.error, details: reply.details }, { status })
    }

    return NextResponse.json({ ok: true, data: reply.data })
  },
  {
    require: 'any',
    csrf: true,
    rateLimit: { points: 10, perSeconds: 60 },
  },
)

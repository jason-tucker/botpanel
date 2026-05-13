/**
 * POST /api/squishy/voice/[id]/hosts/toggle — body `{ userId, op: 'add'|'remove' }`.
 *
 * Add or remove a host on an auto-channel. Calls the squishybot
 * `voice.toggle_host` verb which delegates to the shared `hostsService`
 * so behavior matches the `/voice → Hosts` slash flow exactly.
 *
 * Auth: owner / acting-owner / sudo / bot-owner (mirrors the bot's
 * `isOwner(member, record) || isSudo(member)` gate for the hosts action).
 * Hosts can't add other hosts — that stays owner-only.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { withAuth } from '@/lib/auth/middleware'
import { writeAudit } from '@/lib/audit'
import { callBot } from '@/lib/botrpc'
import { canDestructivelyControlChannel, isSnowflake, loadAutoChannel } from '../../../_lib'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = withAuth(
  async (
    req: NextRequest,
    access,
    ctx: { params: Promise<{ id: string }> },
  ) => {
    const { id } = await ctx.params
    const voiceChannelId = (id ?? '').trim()
    if (!voiceChannelId) {
      return NextResponse.json({ error: 'voiceChannelId is required' }, { status: 400 })
    }

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
    }
    const b = body as { userId?: unknown; op?: unknown } | null
    const userId = b?.userId
    const op = b?.op
    if (typeof userId !== 'string' || !isSnowflake(userId)) {
      return NextResponse.json(
        { error: 'userId must be a Discord snowflake (15-25 digits)' },
        { status: 400 },
      )
    }
    if (op !== 'add' && op !== 'remove') {
      return NextResponse.json({ error: 'op must be add or remove' }, { status: 400 })
    }

    const record = await loadAutoChannel(voiceChannelId)
    if (!record) {
      await writeAudit({
        bot: 'squishy',
        action: 'voice.hosts_toggled',
        actor: access.actor,
        viewing: access.viewing,
        targetType: 'auto_channels',
        targetId: voiceChannelId,
        success: false,
        errorMessage: 'channel-not-found',
      }).catch(() => {})
      return NextResponse.json({ error: 'channel-not-found' }, { status: 404 })
    }

    // Owner / acting-owner / sudo / bot-owner can manage hosts — same gate
    // as transfer + delete (the destructive set), since adding a host
    // grants them control over the room.
    if (!canDestructivelyControlChannel(access, record)) {
      await writeAudit({
        bot: 'squishy',
        action: 'voice.hosts_toggled',
        actor: access.actor,
        viewing: access.viewing,
        targetType: 'auto_channels',
        targetId: voiceChannelId,
        success: false,
        errorMessage: 'forbidden',
      }).catch(() => {})
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }

    const reply = await callBot<{ hostUserIds: string[] }>(
      'squishy',
      'voice.toggle_host',
      { voiceChannelId, userId, op },
    )

    if (!reply.ok) {
      await writeAudit({
        bot: 'squishy',
        action: 'voice.hosts_toggled',
        actor: access.actor,
        viewing: access.viewing,
        targetType: 'auto_channels',
        targetId: voiceChannelId,
        before: { hostUserIds: record.hostUserIds },
        after: { op, userId },
        success: false,
        errorMessage: reply.error,
      }).catch(() => {})
      const status =
        reply.error === 'timeout' || reply.error === 'rpc-not-configured' ? 503 : 400
      return NextResponse.json(
        { error: reply.error, details: reply.details },
        { status },
      )
    }

    await writeAudit({
      bot: 'squishy',
      action: 'voice.hosts_toggled',
      actor: access.actor,
      viewing: access.viewing,
      targetType: 'auto_channels',
      targetId: voiceChannelId,
      before: { hostUserIds: record.hostUserIds },
      after: { hostUserIds: reply.data.hostUserIds, op, userId },
      success: true,
    }).catch(() => {})

    return NextResponse.json({ ok: true, data: reply.data })
  },
  {
    require: 'any',
    csrf: true,
    rateLimit: { points: 30, perSeconds: 60 },
  },
)

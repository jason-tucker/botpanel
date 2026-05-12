/**
 * POST /api/squishy/voice/[id]/transfer — body `{ newOwnerUserId: string }`.
 *
 * Reassigns the auto-channel owner. Mirrors the bot's in-Discord
 * force-owner-transfer flow but restricts to owner-or-sudo on the panel
 * side too (you can't transfer a room you don't own unless you're sudo /
 * bot owner). Bot handler at `services/rpc/handlers/voice/transfer.ts`.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { withAuth } from '@/lib/auth/middleware'
import { writeAudit } from '@/lib/audit'
import { callBot } from '@/lib/botrpc'
import { canDestructivelyControlChannel, isSnowflake, loadAutoChannel } from '../../_lib'

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
    const newOwnerUserId = (body as { newOwnerUserId?: unknown } | null)?.newOwnerUserId
    if (typeof newOwnerUserId !== 'string' || !isSnowflake(newOwnerUserId)) {
      return NextResponse.json(
        { error: 'newOwnerUserId must be a Discord snowflake (15-25 digits)' },
        { status: 400 },
      )
    }

    const record = await loadAutoChannel(voiceChannelId)
    if (!record) {
      await writeAudit({
        bot: 'squishy',
        action: 'voice.transfer',
        actor: access.actor,
        viewing: access.viewing,
        targetType: 'auto_channels',
        targetId: voiceChannelId,
        success: false,
        errorMessage: 'channel-not-found',
      }).catch(() => {})
      return NextResponse.json({ error: 'channel-not-found' }, { status: 404 })
    }

    if (!canDestructivelyControlChannel(access, record)) {
      await writeAudit({
        bot: 'squishy',
        action: 'voice.transfer',
        actor: access.actor,
        viewing: access.viewing,
        targetType: 'auto_channels',
        targetId: voiceChannelId,
        success: false,
        errorMessage: 'forbidden',
      }).catch(() => {})
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }

    const reply = await callBot('squishy', 'voice.transfer', {
      voiceChannelId,
      newOwnerUserId,
      actorUserId: access.viewing.id,
    })

    if (!reply.ok) {
      await writeAudit({
        bot: 'squishy',
        action: 'voice.transfer',
        actor: access.actor,
        viewing: access.viewing,
        targetType: 'auto_channels',
        targetId: voiceChannelId,
        before: { ownerUserId: record.ownerUserId },
        after: { ownerUserId: newOwnerUserId },
        success: false,
        errorMessage: reply.error,
      }).catch(() => {})
      const status = reply.error === 'timeout' || reply.error === 'rpc-not-configured' ? 503 : 400
      return NextResponse.json({ error: reply.error, details: reply.details }, { status })
    }

    await writeAudit({
      bot: 'squishy',
      action: 'voice.transfer',
      actor: access.actor,
      viewing: access.viewing,
      targetType: 'auto_channels',
      targetId: voiceChannelId,
      before: { ownerUserId: record.ownerUserId },
      after: { ownerUserId: newOwnerUserId },
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

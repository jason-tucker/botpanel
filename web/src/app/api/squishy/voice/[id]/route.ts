/**
 * DELETE /api/squishy/voice/[id] — tear down the auto-channel.
 *
 * Restricted to owner-or-sudo on the panel side (the bot mirrors this in
 * `requireOwnerOrSudo` for the in-Discord Delete button). Bot handler at
 * `services/rpc/handlers/voice/delete.ts` delegates to the existing
 * `deleteAutoChannel` service which cleans up timers, both channels, the
 * DB row, member rows, and emits `voice.channel_deleted` so the live
 * panel SSE pops the card immediately.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { withAuth } from '@/lib/auth/middleware'
import { writeAudit } from '@/lib/audit'
import { callBot } from '@/lib/botrpc'
import { canDestructivelyControlChannel, loadAutoChannel } from '../_lib'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const DELETE = withAuth(
  async (
    _req: NextRequest,
    access,
    ctx: { params: Promise<{ id: string }> },
  ) => {
    const { id } = await ctx.params
    const voiceChannelId = (id ?? '').trim()
    if (!voiceChannelId) {
      return NextResponse.json({ error: 'voiceChannelId is required' }, { status: 400 })
    }

    const record = await loadAutoChannel(voiceChannelId)
    if (!record) {
      await writeAudit({
        bot: 'squishy',
        action: 'voice.delete',
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
        action: 'voice.delete',
        actor: access.actor,
        viewing: access.viewing,
        targetType: 'auto_channels',
        targetId: voiceChannelId,
        success: false,
        errorMessage: 'forbidden',
      }).catch(() => {})
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }

    const reply = await callBot('squishy', 'voice.delete', {
      voiceChannelId,
      actorUserId: access.viewing.id,
    })

    if (!reply.ok) {
      await writeAudit({
        bot: 'squishy',
        action: 'voice.delete',
        actor: access.actor,
        viewing: access.viewing,
        targetType: 'auto_channels',
        targetId: voiceChannelId,
        before: record,
        success: false,
        errorMessage: reply.error,
      }).catch(() => {})
      const status = reply.error === 'timeout' || reply.error === 'rpc-not-configured' ? 503 : 400
      return NextResponse.json({ error: reply.error, details: reply.details }, { status })
    }

    await writeAudit({
      bot: 'squishy',
      action: 'voice.delete',
      actor: access.actor,
      viewing: access.viewing,
      targetType: 'auto_channels',
      targetId: voiceChannelId,
      before: record,
      after: null,
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

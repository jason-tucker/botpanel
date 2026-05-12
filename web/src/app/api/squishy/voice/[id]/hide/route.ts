/**
 * POST /api/squishy/voice/[id]/hide — body `{ hidden: boolean }`.
 *
 * Flips the VC's ViewChannel overwrite for `@everyone`. Bot handler at
 * `services/rpc/handlers/voice/hide.ts` denies (or restores) the
 * `@everyone` ViewChannel overwrite and re-grants explicit allows to
 * bot/owner/hosts/sudo roles so they don't lose their own room.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { withAuth } from '@/lib/auth/middleware'
import { writeAudit } from '@/lib/audit'
import { callBot } from '@/lib/botrpc'
import { canControlChannel, loadAutoChannel } from '../../_lib'

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
    const hiddenRaw = (body as { hidden?: unknown } | null)?.hidden
    let hidden: boolean
    if (typeof hiddenRaw === 'boolean') hidden = hiddenRaw
    else if (hiddenRaw === 'true') hidden = true
    else if (hiddenRaw === 'false') hidden = false
    else {
      return NextResponse.json({ error: 'hidden must be a boolean' }, { status: 400 })
    }

    const record = await loadAutoChannel(voiceChannelId)
    if (!record) {
      await writeAudit({
        bot: 'squishy',
        action: 'voice.hide',
        actor: access.actor,
        viewing: access.viewing,
        targetType: 'auto_channels',
        targetId: voiceChannelId,
        success: false,
        errorMessage: 'channel-not-found',
      }).catch(() => {})
      return NextResponse.json({ error: 'channel-not-found' }, { status: 404 })
    }

    if (!canControlChannel(access, record)) {
      await writeAudit({
        bot: 'squishy',
        action: 'voice.hide',
        actor: access.actor,
        viewing: access.viewing,
        targetType: 'auto_channels',
        targetId: voiceChannelId,
        success: false,
        errorMessage: 'forbidden',
      }).catch(() => {})
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }

    const reply = await callBot('squishy', 'voice.hide', {
      voiceChannelId,
      hidden,
      actorUserId: access.viewing.id,
    })

    if (!reply.ok) {
      await writeAudit({
        bot: 'squishy',
        action: 'voice.hide',
        actor: access.actor,
        viewing: access.viewing,
        targetType: 'auto_channels',
        targetId: voiceChannelId,
        before: { hidden: record.isHidden },
        after: { hidden },
        success: false,
        errorMessage: reply.error,
      }).catch(() => {})
      const status = reply.error === 'timeout' || reply.error === 'rpc-not-configured' ? 503 : 400
      return NextResponse.json({ error: reply.error, details: reply.details }, { status })
    }

    await writeAudit({
      bot: 'squishy',
      action: 'voice.hide',
      actor: access.actor,
      viewing: access.viewing,
      targetType: 'auto_channels',
      targetId: voiceChannelId,
      before: { hidden: record.isHidden },
      after: { hidden },
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

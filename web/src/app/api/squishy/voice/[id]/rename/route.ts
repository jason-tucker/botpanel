/**
 * POST /api/squishy/voice/[id]/rename — body `{ newName: string }`.
 *
 * Verifies the viewer can control the channel (owner/host/sudo/botOwner)
 * server-side via the `auto_channels` row, then forwards the call to the
 * bot through the Wave-7a `callBot()` client. Bot-side handler lives at
 * `services/rpc/handlers/voice/rename.ts` — the bot does the sanitize +
 * Discord edits + DB write + control-panel refresh.
 *
 * Audits success AND every rejection so the audit log shows attempted
 * escalations alongside actual writes.
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
    const newName = (body as { newName?: unknown } | null)?.newName
    if (typeof newName !== 'string' || newName.trim().length === 0 || newName.length > 100) {
      return NextResponse.json(
        { error: 'newName must be a non-empty string ≤ 100 chars' },
        { status: 400 },
      )
    }

    const record = await loadAutoChannel(voiceChannelId)
    if (!record) {
      await writeAudit({
        bot: 'squishy',
        action: 'voice.rename',
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
        action: 'voice.rename',
        actor: access.actor,
        viewing: access.viewing,
        targetType: 'auto_channels',
        targetId: voiceChannelId,
        success: false,
        errorMessage: 'forbidden',
      }).catch(() => {})
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }

    // Static-channel companions (`source_hub_id = 'static'`) keep their name
    // forever — the bot refuses the verb too; fail fast with a clear message.
    if (record.sourceHubId === 'static') {
      await writeAudit({
        bot: 'squishy',
        action: 'voice.rename',
        actor: access.actor,
        viewing: access.viewing,
        targetType: 'auto_channels',
        targetId: voiceChannelId,
        success: false,
        errorMessage: 'static-channel',
      }).catch(() => {})
      return NextResponse.json(
        { error: 'Static channels cannot be renamed' },
        { status: 400 },
      )
    }

    const reply = await callBot('squishy', 'voice.rename', {
      voiceChannelId,
      newName,
      actorUserId: access.viewing.id,
    })

    if (!reply.ok) {
      await writeAudit({
        bot: 'squishy',
        action: 'voice.rename',
        actor: access.actor,
        viewing: access.viewing,
        targetType: 'auto_channels',
        targetId: voiceChannelId,
        before: { name: record.manualName ?? record.fallbackName ?? null },
        after: { name: newName },
        success: false,
        errorMessage: reply.error,
      }).catch(() => {})
      const status = reply.error === 'timeout' || reply.error === 'rpc-not-configured' ? 503 : 400
      return NextResponse.json({ error: reply.error, details: reply.details }, { status })
    }

    await writeAudit({
      bot: 'squishy',
      action: 'voice.rename',
      actor: access.actor,
      viewing: access.viewing,
      targetType: 'auto_channels',
      targetId: voiceChannelId,
      before: { name: record.manualName ?? record.fallbackName ?? null },
      after: { name: newName },
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

/**
 * POST /api/squishy/voice/[id]/lock — body `{ locked: boolean }`.
 *
 * Toggles the `@everyone` Connect overwrite on the VC. Server-side gate
 * via `canControlChannel`; bot handler at
 * `services/rpc/handlers/voice/lock.ts` performs the Discord edit + DB
 * write + control-panel refresh + lock-toggled event publish.
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
    const lockedRaw = (body as { locked?: unknown } | null)?.locked
    // The form-encoded fallback in ServerForm coerces booleans into "true" /
    // "false" strings; accept either so the same route works whether the
    // caller sent JSON or url-encoded.
    let locked: boolean
    if (typeof lockedRaw === 'boolean') locked = lockedRaw
    else if (lockedRaw === 'true') locked = true
    else if (lockedRaw === 'false') locked = false
    else {
      return NextResponse.json({ error: 'locked must be a boolean' }, { status: 400 })
    }

    const record = await loadAutoChannel(voiceChannelId)
    if (!record) {
      await writeAudit({
        bot: 'squishy',
        action: 'voice.lock',
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
        action: 'voice.lock',
        actor: access.actor,
        viewing: access.viewing,
        targetType: 'auto_channels',
        targetId: voiceChannelId,
        success: false,
        errorMessage: 'forbidden',
      }).catch(() => {})
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }

    const reply = await callBot('squishy', 'voice.lock', {
      voiceChannelId,
      locked,
      actorUserId: access.viewing.id,
    })

    if (!reply.ok) {
      await writeAudit({
        bot: 'squishy',
        action: 'voice.lock',
        actor: access.actor,
        viewing: access.viewing,
        targetType: 'auto_channels',
        targetId: voiceChannelId,
        before: { locked: record.isLocked },
        after: { locked },
        success: false,
        errorMessage: reply.error,
      }).catch(() => {})
      const status = reply.error === 'timeout' || reply.error === 'rpc-not-configured' ? 503 : 400
      return NextResponse.json({ error: reply.error, details: reply.details }, { status })
    }

    await writeAudit({
      bot: 'squishy',
      action: 'voice.lock',
      actor: access.actor,
      viewing: access.viewing,
      targetType: 'auto_channels',
      targetId: voiceChannelId,
      before: { locked: record.isLocked },
      after: { locked },
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

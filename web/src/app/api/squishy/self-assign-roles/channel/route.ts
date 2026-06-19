/**
 * POST /api/squishy/self-assign-roles/channel — set (or clear) the self-assign
 * board's destination channel.
 *
 * Body: `{ channelId: string|null }`.
 *   - A 15-25 digit Discord snowflake string sets the channel.
 *   - `null` or empty string clears it (board won't post until re-set).
 *
 * Delegates to `callBot('squishy','selfassign.set_channel',{channelId})`.
 * The bot persists the value in `bot_settings` under key
 * `selfassign.channel_id`. Gating: sudo, CSRF. No tight rate-limit needed
 * (channel changes are rare), uses the standard 30/min.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { withAuth } from '@/lib/auth/middleware'
import { writeAudit } from '@/lib/audit'
import { callBot } from '@/lib/botrpc'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SNOWFLAKE_RE = /^\d{15,25}$/

export const POST = withAuth(
  async (req: NextRequest, access) => {
    let body: unknown
    try {
      body = await req.json()
    } catch {
      await writeAudit({
        bot: 'squishy',
        action: 'selfassign.channel_set',
        actor: access.actor,
        viewing: access.viewing,
        targetType: 'self_assign_entries',
        success: false,
        errorMessage: 'invalid-json',
      }).catch(() => {})
      return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
    }

    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'body must be a JSON object' }, { status: 400 })
    }
    const o = body as Record<string, unknown>
    const raw = o.channelId

    let channelId: string | null
    if (raw === null || raw === undefined || raw === '') {
      channelId = null
    } else if (typeof raw === 'string') {
      const trimmed = raw.trim()
      if (trimmed === '') {
        channelId = null
      } else if (!SNOWFLAKE_RE.test(trimmed)) {
        await writeAudit({
          bot: 'squishy',
          action: 'selfassign.channel_set',
          actor: access.actor,
          viewing: access.viewing,
          targetType: 'self_assign_entries',
          success: false,
          errorMessage: 'invalid-snowflake',
        }).catch(() => {})
        return NextResponse.json(
          { error: 'channelId must be a Discord snowflake (15-25 digits) or null' },
          { status: 400 },
        )
      } else {
        channelId = trimmed
      }
    } else {
      return NextResponse.json(
        { error: 'channelId must be a string or null' },
        { status: 400 },
      )
    }

    const reply = await callBot<{ channelId: string | null }>(
      'squishy',
      'selfassign.set_channel',
      { channelId },
    )

    if (!reply.ok) {
      await writeAudit({
        bot: 'squishy',
        action: 'selfassign.channel_set',
        actor: access.actor,
        viewing: access.viewing,
        targetType: 'self_assign_entries',
        before: null,
        after: { channelId },
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
      action: 'selfassign.channel_set',
      actor: access.actor,
      viewing: access.viewing,
      targetType: 'self_assign_entries',
      before: null,
      after: { channelId: reply.data.channelId },
      success: true,
    }).catch((err) => {
      console.warn('[self-assign-roles/channel POST] audit write failed', err)
    })

    return NextResponse.json({ ok: true, channelId: reply.data.channelId })
  },
  {
    require: 'sudo',
    csrf: true,
    rateLimit: { points: 30, perSeconds: 60 },
  },
)

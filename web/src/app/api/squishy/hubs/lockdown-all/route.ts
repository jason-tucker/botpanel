/**
 * POST /api/squishy/hubs/lockdown-all — guild-wide hub lock / unlock.
 *
 * Body: `{locked: boolean, durationMinutes?: number}` (JSON only).
 *
 * Calls `hub.lockdown_all` on the bot which delegates to the existing
 * `lockAllHubs` / `unlockAllHubs` services. The bot persists the policy
 * in `bot_settings.voice.guild_lockdown_until` so it survives a restart,
 * and publishes `voice.lockdown_started/ended` Redis events for fan-out.
 *
 * Sudo-gated; CSRF + 10/min rate limit (tighter than the per-hub route —
 * this is a high-blast-radius action). Audited `hub.lockdown` with
 * `targetType: 'all'` so the unified audit tail can distinguish it from
 * per-hub flips on the same action name.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { withAuth } from '@/lib/auth/middleware'
import { writeAudit } from '@/lib/audit'
import { callBot } from '@/lib/botrpc'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_DURATION_MINUTES = 60 * 24 * 30 // 30 days — matches bot-side cap

export const POST = withAuth(
  async (req: NextRequest, access) => {
    let body: { locked?: unknown; durationMinutes?: unknown }
    try {
      body = (await req.json()) ?? {}
    } catch {
      await writeAudit({
        bot: 'squishy',
        action: 'hub.lockdown',
        actor: access.actor,
        viewing: access.viewing,
        targetType: 'all',
        success: false,
        errorMessage: 'invalid-json',
      }).catch(() => {})
      return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
    }

    if (typeof body.locked !== 'boolean') {
      if (body.locked === 'true' || body.locked === '1') body.locked = true
      else if (body.locked === 'false' || body.locked === '0' || body.locked === '') body.locked = false
      else {
        return NextResponse.json(
          { error: 'locked must be a boolean' },
          { status: 400 },
        )
      }
    }
    const locked = body.locked as boolean

    let durationMinutes: number | undefined
    if (body.durationMinutes !== undefined && body.durationMinutes !== null && body.durationMinutes !== '') {
      const n =
        typeof body.durationMinutes === 'number'
          ? body.durationMinutes
          : Number(body.durationMinutes)
      if (
        !Number.isFinite(n) ||
        !Number.isInteger(n) ||
        n <= 0 ||
        n > MAX_DURATION_MINUTES
      ) {
        return NextResponse.json(
          { error: `durationMinutes must be a positive integer ≤ ${MAX_DURATION_MINUTES}` },
          { status: 400 },
        )
      }
      durationMinutes = n
    }

    const reply = await callBot('squishy', 'hub.lockdown_all', {
      locked,
      ...(durationMinutes !== undefined ? { durationMinutes } : {}),
    })

    const success = reply.ok === true
    await writeAudit({
      bot: 'squishy',
      action: 'hub.lockdown',
      actor: access.actor,
      viewing: access.viewing,
      targetType: 'all',
      after: { locked, durationMinutes: durationMinutes ?? null, reply },
      success,
      errorMessage: success ? null : (reply as { error?: string }).error ?? 'rpc-failed',
    }).catch((err) => {
      console.warn('[squishy/hubs lockdown-all] audit write failed', err)
    })

    return NextResponse.json({ reply })
  },
  {
    require: 'sudo',
    csrf: true,
    rateLimit: { points: 10, perSeconds: 60 },
  },
)

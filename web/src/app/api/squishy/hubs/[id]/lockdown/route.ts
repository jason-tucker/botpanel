/**
 * POST /api/squishy/hubs/[id]/lockdown — per-hub lock/unlock.
 *
 * `[id]` is the `hub_channels.id` UUID; we look up the row to get the
 * Discord voice-channel snowflake, then call `hub.lockdown` on the bot
 * with `{hubChannelId, locked, durationMinutes?}`.
 *
 * Body: `{locked: boolean, durationMinutes?: number}` (JSON only).
 *
 * Why route through the UUID rather than accepting the channelId
 * directly: the page already keys per-row buttons by `hub.id`, the
 * row carries the canonical channelId mapping (and a renamed hub
 * keeps the same UUID even after the reconciler swaps the snowflake),
 * and the channelId is leaked anywhere a sudo can already see it.
 *
 * Sudo-gated; CSRF + 30/min rate limit. Audited `hub.lockdown` on
 * success AND failure. The bot's own `lockHub` / `unlockHub` services
 * already publish `voice.lockdown_started/ended` Redis events for
 * downstream consumers, so this route doesn't need to fan out further.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { withAuth } from '@/lib/auth/middleware'
import { writeAudit } from '@/lib/audit'
import { squishyDb, squishySchema } from '@/lib/db/squishy'
import { callBot } from '@/lib/botrpc'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_DURATION_MINUTES = 60 * 24 * 30 // 30 days — matches bot-side cap

export const POST = withAuth(
  async (
    req: NextRequest,
    access,
    ctx: { params: Promise<{ id: string }> },
  ) => {
    const { id } = await ctx.params
    const hubId = (id ?? '').trim()
    if (!UUID_RE.test(hubId)) {
      await writeAudit({
        bot: 'squishy',
        action: 'hub.lockdown',
        actor: access.actor,
        viewing: access.viewing,
        targetType: 'hub_channels',
        targetId: hubId,
        success: false,
        errorMessage: 'invalid-id',
      }).catch(() => {})
      return NextResponse.json(
        { error: 'id must be the hub_channels.id UUID' },
        { status: 400 },
      )
    }

    let body: { locked?: unknown; durationMinutes?: unknown }
    try {
      body = (await req.json()) ?? {}
    } catch {
      return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
    }

    if (typeof body.locked !== 'boolean') {
      // `<ServerForm>` checkboxes / text inputs send strings — accept
      // common truthy/falsy spellings as a courtesy.
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

    // Look up the channelId from the UUID so the panel doesn't have to
    // pass it (and so a stale UI link can't drive a lockdown on an
    // already-deleted hub).
    let channelId: string
    try {
      const rows = await squishyDb
        .select({ channelId: squishySchema.hubChannels.channelId })
        .from(squishySchema.hubChannels)
        .where(eq(squishySchema.hubChannels.id, hubId))
      if (rows.length === 0) {
        await writeAudit({
          bot: 'squishy',
          action: 'hub.lockdown',
          actor: access.actor,
          viewing: access.viewing,
          targetType: 'hub_channels',
          targetId: hubId,
          success: false,
          errorMessage: 'not-found',
        }).catch(() => {})
        return NextResponse.json({ error: 'not found' }, { status: 404 })
      }
      channelId = rows[0].channelId
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown'
      console.error('[squishy/hubs lockdown] DB lookup failed', err)
      await writeAudit({
        bot: 'squishy',
        action: 'hub.lockdown',
        actor: access.actor,
        viewing: access.viewing,
        targetType: 'hub_channels',
        targetId: hubId,
        success: false,
        errorMessage: msg,
      }).catch(() => {})
      return NextResponse.json({ error: 'db-lookup-failed' }, { status: 503 })
    }

    const reply = await callBot('squishy', 'hub.lockdown', {
      hubChannelId: channelId,
      locked,
      ...(durationMinutes !== undefined ? { durationMinutes } : {}),
    })

    const success = reply.ok === true
    await writeAudit({
      bot: 'squishy',
      action: 'hub.lockdown',
      actor: access.actor,
      viewing: access.viewing,
      targetType: 'hub_channels',
      targetId: hubId,
      after: { hubChannelId: channelId, locked, durationMinutes: durationMinutes ?? null, reply },
      success,
      errorMessage: success ? null : (reply as { error?: string }).error ?? 'rpc-failed',
    }).catch((err) => {
      console.warn('[squishy/hubs lockdown] audit write failed', err)
    })

    // Always 200; the `reply.ok` flag carries the real success signal,
    // matching the rpc-test route pattern.
    return NextResponse.json({ reply })
  },
  {
    require: 'sudo',
    csrf: true,
    rateLimit: { points: 30, perSeconds: 60 },
  },
)

/**
 * POST /api/otter/oc-stock/post — publish the live OC stock card to a Discord
 * channel by handing off to the bot's `oc.stock_post` RPC verb.
 *
 * Wave 7c-C. The "Manage stock" page already supports add/edit/remove —
 * this surface lets an OC member push the live card to a Discord channel
 * after they've finished editing, mirroring the `/oc → Send to Channel`
 * button inside Discord. The card is rendered bot-side from the same
 * `buildOCPublicContainer` renderer the slash command uses, so the panel
 * never sees the Discord-side payload shape.
 *
 * Gating: `withAuth({require:'any', csrf:true, rateLimit:{points:10,
 * perSeconds:60}})`. The middleware-level `'any'` (logged-in) gate is
 * narrowed by a route-local capability check: you must be able to SEE the
 * board under the configurable OC-stock rules (see
 * `@/lib/otter/ocStockAccess`) and then either hold any OC business
 * mapping (employee / manager / owner) or pass the edit rule. Posting is a
 * low-risk, eventually-visible action and we want every OC staffer to be
 * able to do it without granting the full editor capability — but pushing
 * a card someone isn't allowed to look at makes no sense, so `canView` is
 * a hard prerequisite. Bot owner always wins.
 *
 * Body shape: `{ channelId: string }` — snowflake-validated.
 *
 * On bot RPC success returns the `{messageId, channelId}` envelope the
 * verb hands back; on failure proxies the `error` code (e.g.
 * `channel-not-found`, `not-text-based`, the underlying `send()` error
 * message). Audits both branches as `oc.stock_posted` with the bot's
 * reply payload for forensics — `before:null` because no DB row exists
 * for the posted card.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { withAuth } from '@/lib/auth/middleware'
import { writeAudit } from '@/lib/audit'
import { callBot } from '@/lib/botrpc'
import { OC_SLUG, resolveOcStockAccess } from '@/lib/otter/ocStockAccess'
import type { AccessMap } from '@/lib/auth/perms'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SNOWFLAKE_RE = /^\d{17,20}$/

const bodySchema = z.object({
  channelId: z
    .string()
    .trim()
    .regex(SNOWFLAKE_RE, 'channelId must be a Discord snowflake (17-20 digits)'),
})

async function canPostOcStock(access: AccessMap): Promise<boolean> {
  // Any OC business mapping (employee / manager / owner) is enough — posting
  // the public stock card is lighter than editing it. Bot owner always wins.
  if (access.botOwner) return true
  const caps = await resolveOcStockAccess(access)
  if (!caps.canView) return false
  if (caps.canEdit) return true
  const rank = access.otter.businesses[OC_SLUG]
  return rank === 'owner' || rank === 'manager' || rank === 'employee'
}

type StockPostReply = { messageId: string; channelId: string }

export const POST = withAuth(
  async (req: NextRequest, access) => {
    if (!(await canPostOcStock(access))) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }

    let parsed: z.infer<typeof bodySchema>
    try {
      const raw = (await req.json()) as unknown
      parsed = bodySchema.parse(raw)
    } catch (err) {
      const message = err instanceof z.ZodError ? err.issues[0]?.message ?? 'invalid' : 'invalid body'
      await writeAudit({
        bot: 'otter',
        actor: access.actor,
        viewing: access.viewing,
        action: 'oc.stock_posted',
        targetType: 'oc_stock',
        before: null,
        after: null,
        success: false,
        errorMessage: message,
      }).catch(() => {})
      return NextResponse.json({ error: message }, { status: 400 })
    }

    const reply = await callBot<StockPostReply>(
      'otter',
      'oc.stock_post',
      { channelId: parsed.channelId },
      { timeoutMs: 10_000 },
    )

    if (!reply.ok) {
      await writeAudit({
        bot: 'otter',
        actor: access.actor,
        viewing: access.viewing,
        action: 'oc.stock_posted',
        targetType: 'oc_stock',
        before: null,
        after: { channelId: parsed.channelId },
        success: false,
        errorMessage: reply.error,
      }).catch(() => {})
      // 502 — structured failure from the downstream bot. Pass the error
      // code through verbatim so the form banner shows `channel-not-found`,
      // `not-text-based`, `timeout`, etc.
      return NextResponse.json(
        { error: reply.error, details: reply.details ?? null },
        { status: 502 },
      )
    }

    await writeAudit({
      bot: 'otter',
      actor: access.actor,
      viewing: access.viewing,
      action: 'oc.stock_posted',
      targetType: 'oc_stock',
      targetId: reply.data.messageId,
      before: null,
      after: reply.data,
      success: true,
    }).catch((err: unknown) => {
      console.warn('[api/otter/oc-stock/post] audit write failed', err)
    })

    return NextResponse.json({ ok: true, ...reply.data })
  },
  {
    require: 'any',
    csrf: true,
    // Tight: each call posts a real Discord message. Click-spam can't
    // carpet-bomb the configured channel.
    rateLimit: { points: 10, perSeconds: 60 },
  },
)

/**
 * POST /api/otter/caked/messages — update an editable `/caked` card body.
 *
 * Body: `{ messageKey: string, body: string }`. Routes through the bot's
 * `business_messages.update` RPC verb with `businessSlug: 'caked-up'`.
 *
 * Gate: Caked manager+ of `caked-up`, or bot owner. We re-check inside
 * the handler (`withAuth({require:'any'})` only gates "logged in") so the
 * page-level affordance and the route can't drift.
 *
 * CSRF + rate-limit are enforced by `withAuth`. Rate limit: 30/min/actor —
 * generous because the operator is realistically saving 4–8 fields at most.
 *
 * Audit: every attempt (success OR failure) writes `caked.message_updated`
 * with the key, before-truncated and after-truncated bodies, so the unified
 * `/audit` tail picks it up.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { withAuth } from '@/lib/auth/middleware'
import { callBot } from '@/lib/botrpc'
import { writeAudit } from '@/lib/audit'
import type { AccessMap } from '@/lib/auth/perms'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CAKED_SLUG = 'caked-up'

const bodySchema = z.object({
  messageKey: z.string().min(1).max(128),
  body: z.string().min(1).max(4000),
})

function canEditCaked(access: AccessMap): boolean {
  if (access.botOwner) return true
  const rank = access.otter.businesses[CAKED_SLUG]
  return rank === 'manager' || rank === 'owner'
}

export const POST = withAuth(
  async (req: NextRequest, access) => {
    if (!canEditCaked(access)) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }

    let parsed: z.infer<typeof bodySchema>
    try {
      const raw = (await req.json()) as unknown
      parsed = bodySchema.parse(raw)
    } catch (err) {
      const details = err instanceof z.ZodError ? err.issues : 'invalid body'
      return NextResponse.json({ error: 'invalid', details }, { status: 400 })
    }

    const reply = await callBot<{
      key: string
      body: string
      updatedAt: string
    }>('otter', 'business_messages.update', {
      businessSlug: CAKED_SLUG,
      messageKey: parsed.messageKey,
      body: parsed.body,
      actorUserId: access.actor.id,
    })

    void writeAudit({
      bot: 'otter',
      actor: access.actor,
      viewing: access.viewing,
      action: 'caked.message_updated',
      targetType: 'business_message',
      targetId: parsed.messageKey,
      before: null,
      // The audit sanitiser already truncates long values; we surface the
      // first 500 chars on the audit row so an operator can spot-check
      // edits without bloating the table.
      after: { body: parsed.body },
      success: reply.ok,
      errorMessage: reply.ok ? undefined : reply.error,
    }).catch((auditErr: unknown) => {
      console.warn('[api/otter/caked/messages] audit write failed', auditErr)
    })

    return NextResponse.json({ reply })
  },
  {
    require: 'any',
    csrf: true,
    rateLimit: { points: 30, perSeconds: 60 },
  },
)

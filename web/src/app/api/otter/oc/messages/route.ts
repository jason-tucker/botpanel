/**
 * POST /api/otter/oc/messages — update an editable `/oc` Requirements
 * card body.
 *
 * Body: `{ messageKey: string, body: string }`. Routes through the bot's
 * `business_messages.update` RPC verb with `businessSlug: 'original-clothing'`.
 *
 * Gate: OC manager+ of `original-clothing`, or bot owner. Re-checked
 * inside the handler so it stays in lockstep with the page-level
 * affordance.
 *
 * CSRF + rate-limit are enforced by `withAuth`. Rate limit: 30/min/actor.
 *
 * Audit: every attempt writes `oc.message_updated` with the key + new body
 * so the unified `/audit` tail picks it up.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { withAuth } from '@/lib/auth/middleware'
import { callBot } from '@/lib/botrpc'
import { writeAudit } from '@/lib/audit'
import type { AccessMap } from '@/lib/auth/perms'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const OC_SLUG = 'original-clothing'

const bodySchema = z.object({
  messageKey: z.string().min(1).max(128),
  body: z.string().min(1).max(4000),
})

function canEditOc(access: AccessMap): boolean {
  if (access.botOwner) return true
  const rank = access.otter.businesses[OC_SLUG]
  return rank === 'manager' || rank === 'owner'
}

export const POST = withAuth(
  async (req: NextRequest, access) => {
    if (!canEditOc(access)) {
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
      businessSlug: OC_SLUG,
      messageKey: parsed.messageKey,
      body: parsed.body,
      actorUserId: access.actor.id,
    })

    void writeAudit({
      bot: 'otter',
      actor: access.actor,
      viewing: access.viewing,
      action: 'oc.message_updated',
      targetType: 'business_message',
      targetId: parsed.messageKey,
      before: null,
      after: { body: parsed.body },
      success: reply.ok,
      errorMessage: reply.ok ? undefined : reply.error,
    }).catch((auditErr: unknown) => {
      console.warn('[api/otter/oc/messages] audit write failed', auditErr)
    })

    return NextResponse.json({ reply })
  },
  {
    require: 'any',
    csrf: true,
    rateLimit: { points: 30, perSeconds: 60 },
  },
)

/**
 * POST /api/otter/oc/messages/reset — delete an `/oc` Requirements
 * body override.
 *
 * Body: `{ messageKey: string }`. Routes through the bot's
 * `business_messages.reset` RPC verb. Next /oc render falls back to the
 * hardcoded default.
 *
 * Gate / CSRF / rate-limit / audit posture mirrors the update route.
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

    const reply = await callBot<{ key: string; deleted: boolean }>(
      'otter',
      'business_messages.reset',
      {
        businessSlug: OC_SLUG,
        messageKey: parsed.messageKey,
        actorUserId: access.actor.id,
      },
    )

    void writeAudit({
      bot: 'otter',
      actor: access.actor,
      viewing: access.viewing,
      action: 'oc.message_reset',
      targetType: 'business_message',
      targetId: parsed.messageKey,
      before: null,
      after: null,
      success: reply.ok,
      errorMessage: reply.ok ? undefined : reply.error,
    }).catch((auditErr: unknown) => {
      console.warn('[api/otter/oc/messages/reset] audit write failed', auditErr)
    })

    return NextResponse.json({ reply })
  },
  {
    require: 'any',
    csrf: true,
    rateLimit: { points: 30, perSeconds: 60 },
  },
)

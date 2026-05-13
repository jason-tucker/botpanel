/**
 * POST /api/otter/caked/messages/reset — delete a `/caked` body override.
 *
 * Body: `{ messageKey: string }`. Routes through the bot's
 * `business_messages.reset` RPC verb. Next /caked render falls back to
 * the hardcoded default body.
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

const CAKED_SLUG = 'caked-up'

const bodySchema = z.object({
  messageKey: z.string().min(1).max(128),
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

    const reply = await callBot<{ key: string; deleted: boolean }>(
      'otter',
      'business_messages.reset',
      {
        businessSlug: CAKED_SLUG,
        messageKey: parsed.messageKey,
        actorUserId: access.actor.id,
      },
    )

    void writeAudit({
      bot: 'otter',
      actor: access.actor,
      viewing: access.viewing,
      action: 'caked.message_reset',
      targetType: 'business_message',
      targetId: parsed.messageKey,
      before: null,
      after: null,
      success: reply.ok,
      errorMessage: reply.ok ? undefined : reply.error,
    }).catch((auditErr: unknown) => {
      console.warn('[api/otter/caked/messages/reset] audit write failed', auditErr)
    })

    return NextResponse.json({ reply })
  },
  {
    require: 'any',
    csrf: true,
    rateLimit: { points: 30, perSeconds: 60 },
  },
)

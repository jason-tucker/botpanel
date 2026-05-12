/**
 * POST /api/otter/businesses/[slug]/employees/hire
 * Body: `{ userId: string, rank: 'employee'|'manager'|'owner' }`
 *
 * Forwards to `cmd.otter.employee.hire` via `callBot`. The bot owns the
 * Discord-role mutation + the `business_owners` write when the rank is
 * `owner`. We audit before AND after the bot call so the row records the
 * actor + viewing pair even when the bot rejects.
 *
 * Permission rules:
 *  - `employee` / `manager` rank: business `owner` OR `manager` (or bot owner).
 *  - `owner` rank: business `owner` only (or bot owner) — managers cannot
 *    promote someone to owner via this route, matching the slash-command
 *    convention.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { withAuth } from '@/lib/auth/middleware'
import { writeAudit } from '@/lib/audit'
import { callBot } from '@/lib/botrpc'
import {
  baseBodySchema,
  canActAsOwner,
  canManage,
  readJsonBody,
  resolveBusinessId,
} from '../_lib'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const bodySchema = baseBodySchema.extend({
  rank: z.enum(['employee', 'manager', 'owner']),
})

type RouteCtx = { params: Promise<{ slug: string }> }

export const POST = withAuth<[RouteCtx]>(
  async (req: NextRequest, access, ctx) => {
    const { slug } = await ctx.params

    let body: z.infer<typeof bodySchema>
    try {
      body = bodySchema.parse(await readJsonBody(req))
    } catch (err) {
      const details = err instanceof z.ZodError ? err.issues : 'invalid body'
      await writeAudit({
        bot: 'otter',
        actor: access.actor,
        viewing: access.viewing,
        action: 'employee.hire',
        targetType: 'business',
        targetId: slug,
        success: false,
        errorMessage: 'invalid-body',
        after: { slug, details },
      }).catch(() => {})
      return NextResponse.json({ error: 'invalid', details }, { status: 400 })
    }

    const rank = access.otter.businesses[slug]
    const allowed =
      body.rank === 'owner'
        ? canActAsOwner(rank, access.botOwner)
        : canManage(rank, access.botOwner)
    if (!allowed) {
      await writeAudit({
        bot: 'otter',
        actor: access.actor,
        viewing: access.viewing,
        action: 'employee.hire',
        targetType: 'business',
        targetId: slug,
        success: false,
        errorMessage: 'forbidden',
        after: { slug, targetUserId: body.userId, rank: body.rank },
      }).catch(() => {})
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }

    const businessId = await resolveBusinessId(slug)
    if (!businessId) {
      await writeAudit({
        bot: 'otter',
        actor: access.actor,
        viewing: access.viewing,
        action: 'employee.hire',
        targetType: 'business',
        targetId: slug,
        success: false,
        errorMessage: 'business-not-found',
        after: { slug, targetUserId: body.userId },
      }).catch(() => {})
      return NextResponse.json({ error: 'not-found' }, { status: 404 })
    }

    const reply = await callBot<{ before: string | null; after: string | null }>(
      'otter',
      'employee.hire',
      { businessSlug: slug, userId: body.userId, rank: body.rank },
    )

    if (!reply.ok) {
      await writeAudit({
        bot: 'otter',
        actor: access.actor,
        viewing: access.viewing,
        action: 'employee.hire',
        targetType: 'business',
        targetId: slug,
        before: reply.data?.before,
        after: reply.data?.after,
        success: false,
        errorMessage: reply.error,
      }).catch(() => {})
      const status =
        reply.error === 'timeout' || reply.error === 'rpc-not-configured'
          ? 503
          : 400
      return NextResponse.json(
        { error: reply.error, details: reply.details },
        { status },
      )
    }

    await writeAudit({
      bot: 'otter',
      actor: access.actor,
      viewing: access.viewing,
      action: 'employee.hire',
      targetType: 'business',
      targetId: slug,
      before: reply.data?.before,
      after: reply.data?.after,
      success: true,
    }).catch(() => {})

    return NextResponse.json({
      ok: true,
      slug,
      targetUserId: body.userId,
      data: reply.data,
    })
  },
  {
    require: 'any',
    csrf: true,
    rateLimit: { points: 30, perSeconds: 60 },
  },
)

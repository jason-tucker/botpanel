/**
 * POST /api/otter/businesses/[slug]/employees/demote
 * Body: `{ userId: string }`
 *
 * Forwards to `cmd.otter.employee.demote`. The bot walks the rank
 * ladder one rung down (owner → manager → employee). Demoting an owner
 * also clears the `business_owners` DB row on the bot side so the
 * effective-rank read agrees with the Discord-side mutation.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { withAuth } from '@/lib/auth/middleware'
import { writeAudit } from '@/lib/audit'
import { callBot } from '@/lib/botrpc'
import {
  baseBodySchema,
  canManage,
  readJsonBody,
  resolveBusinessId,
} from '../_lib'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const bodySchema = baseBodySchema

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
        action: 'employee.demote',
        targetType: 'business',
        targetId: slug,
        success: false,
        errorMessage: 'invalid-body',
        after: { slug, details },
      }).catch(() => {})
      return NextResponse.json({ error: 'invalid', details }, { status: 400 })
    }

    const rank = access.otter.businesses[slug]
    if (!canManage(rank, access.botOwner)) {
      await writeAudit({
        bot: 'otter',
        actor: access.actor,
        viewing: access.viewing,
        action: 'employee.demote',
        targetType: 'business',
        targetId: slug,
        success: false,
        errorMessage: 'forbidden',
        after: { slug, targetUserId: body.userId },
      }).catch(() => {})
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }

    const businessId = await resolveBusinessId(slug)
    if (!businessId) {
      await writeAudit({
        bot: 'otter',
        actor: access.actor,
        viewing: access.viewing,
        action: 'employee.demote',
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
      'employee.demote',
      { businessSlug: slug, userId: body.userId },
    )

    if (!reply.ok) {
      await writeAudit({
        bot: 'otter',
        actor: access.actor,
        viewing: access.viewing,
        action: 'employee.demote',
        targetType: 'business',
        targetId: slug,
        before: null,
        after: null,
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
      action: 'employee.demote',
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

/**
 * POST /api/otter/businesses/[slug]/employees/fire
 * Body: `{ userId: string, reason?: string }`
 *
 * Forwards to `cmd.otter.employee.fire` via `callBot`. Owners CANNOT be
 * fired through the panel — managers / owners must first `demote` them to
 * a lower rank or use Discord's `/employee` slash command. The 400
 * `cannot-fire-owner` is the documented sentinel and EmployeePanel uses
 * it to render a clear hint.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { withAuth } from '@/lib/auth/middleware'
import { writeAudit } from '@/lib/audit'
import { callBot } from '@/lib/botrpc'
import {
  baseBodySchema,
  canManage,
  isDbOwner,
  readJsonBody,
  resolveBusinessId,
} from '../_lib'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const bodySchema = baseBodySchema.extend({
  reason: z.string().trim().max(500).optional(),
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
        action: 'employee.fire',
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
        action: 'employee.fire',
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
        action: 'employee.fire',
        targetType: 'business',
        targetId: slug,
        success: false,
        errorMessage: 'business-not-found',
        after: { slug, targetUserId: body.userId },
      }).catch(() => {})
      return NextResponse.json({ error: 'not-found' }, { status: 404 })
    }

    // Owner-fire guard. Checked AFTER the auth gate so we leak the same 403
    // shape to non-managers and never accidentally tell them whether the
    // target is an owner.
    if (await isDbOwner(businessId, body.userId)) {
      await writeAudit({
        bot: 'otter',
        actor: access.actor,
        viewing: access.viewing,
        action: 'employee.fire',
        targetType: 'business',
        targetId: slug,
        success: false,
        errorMessage: 'cannot-fire-owner',
        after: { slug, targetUserId: body.userId },
      }).catch(() => {})
      return NextResponse.json({ error: 'cannot-fire-owner' }, { status: 400 })
    }

    const reply = await callBot<{ before: string | null; after: string | null }>(
      'otter',
      'employee.fire',
      { businessSlug: slug, userId: body.userId, reason: body.reason },
    )

    if (!reply.ok) {
      await writeAudit({
        bot: 'otter',
        actor: access.actor,
        viewing: access.viewing,
        action: 'employee.fire',
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
      action: 'employee.fire',
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

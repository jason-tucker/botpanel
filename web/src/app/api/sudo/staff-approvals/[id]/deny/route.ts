/**
 * POST /api/sudo/staff-approvals/[id]/deny — sudo-only denial of a
 * pending staff role request queued in Squishy's `staff_approvals`.
 *
 * Pairs with the approve route. Sets status to `denied`, stamps
 * `reviewed_by` + `reviewed_at` with the real actor, and audits
 * `staff.denied`. No bot RPC — deny is a panel-only state transition
 * (the role was never granted, so there's nothing for Discord to undo).
 *
 * Gating + envelope: sudo, CSRF, 30/min/actor — same as approve.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { withAuth } from '@/lib/auth/middleware'
import { writeAudit } from '@/lib/audit'
import { squishyDb, squishySchema } from '@/lib/db/squishy'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type RouteCtx = { params: Promise<{ id: string }> }

export const POST = withAuth<[RouteCtx]>(
  async (_req: NextRequest, access, ctx: RouteCtx) => {
    const { id } = await ctx.params

    if (!UUID_RE.test(id)) {
      await writeAudit({
        bot: 'squishy',
        action: 'staff.denied',
        targetType: 'staff_approvals',
        targetId: id,
        actor: access.actor, viewing: access.viewing,
        before: null, after: null,
        success: false,
        errorMessage: 'invalid-uuid',
      }).catch(() => {})
      return NextResponse.json({ error: 'id must be a UUID' }, { status: 400 })
    }

    let before:
      | {
          id: string
          guildId: string
          userId: string
          requestedData: unknown
          status: string
        }
      | null = null
    try {
      const rows = await squishyDb
        .select({
          id: squishySchema.staffApprovals.id,
          guildId: squishySchema.staffApprovals.guildId,
          userId: squishySchema.staffApprovals.userId,
          requestedData: squishySchema.staffApprovals.requestedData,
          status: squishySchema.staffApprovals.status,
        })
        .from(squishySchema.staffApprovals)
        .where(eq(squishySchema.staffApprovals.id, id))
        .limit(1)
      before = rows[0] ?? null
    } catch (err) {
      console.error('[staff-approvals/deny] read failed', err)
      await writeAudit({
        bot: 'squishy',
        action: 'staff.denied',
        targetType: 'staff_approvals',
        targetId: id,
        actor: access.actor, viewing: access.viewing,
        before: null, after: null,
        success: false,
        errorMessage: 'db-read-failed',
      }).catch(() => {})
      return NextResponse.json({ error: 'db-read-failed' }, { status: 503 })
    }

    if (!before) {
      return NextResponse.json({ error: 'not-found' }, { status: 404 })
    }
    if (before.status !== 'pending') {
      return NextResponse.json(
        { error: 'already-decided', status: before.status },
        { status: 409 },
      )
    }

    const decidedAt = new Date()
    try {
      await squishyDb
        .update(squishySchema.staffApprovals)
        .set({
          status: 'denied',
          reviewedBy: access.actor.id,
          reviewedAt: decidedAt,
        })
        .where(eq(squishySchema.staffApprovals.id, id))
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown'
      console.error('[staff-approvals/deny] update failed', err)
      await writeAudit({
        bot: 'squishy',
        action: 'staff.denied',
        targetType: 'staff_approvals',
        targetId: id,
        actor: access.actor, viewing: access.viewing,
        before, after: null,
        success: false,
        errorMessage: msg,
      }).catch(() => {})
      return NextResponse.json({ error: 'db-write-failed' }, { status: 503 })
    }

    const after = {
      status: 'denied',
      reviewedBy: access.actor.id,
      reviewedAt: decidedAt.toISOString(),
    }

    await writeAudit({
      bot: 'squishy',
      action: 'staff.denied',
      targetType: 'staff_approvals',
      targetId: id,
      actor: access.actor, viewing: access.viewing,
      before, after,
      success: true,
    }).catch((err) => {
      console.warn('[staff-approvals/deny] audit failed (non-fatal)', err)
    })

    return NextResponse.json({ success: true, id, status: 'denied' })
  },
  {
    require: 'sudo',
    csrf: true,
    rateLimit: { points: 30, perSeconds: 60 },
  },
)

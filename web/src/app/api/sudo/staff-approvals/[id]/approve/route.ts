/**
 * POST /api/sudo/staff-approvals/[id]/approve — sudo-only approval of a
 * pending staff role request queued in Squishy's `staff_approvals`.
 *
 * Flow:
 *  1. Look up the row by id and refuse anything not currently `pending` —
 *     idempotent on the panel side, but a second click after the first one
 *     already moved status forward is surfaced as 409 so the operator can
 *     see "someone else got there first" rather than re-running the grant.
 *  2. Mark the row `granted` with `reviewed_by` + `reviewed_at` set to the
 *     real actor (not the View-As target — accountability sticks to the
 *     human who clicked) BEFORE attempting the Discord grant. This way a
 *     Discord-side failure leaves the queue in a definite state — the
 *     audit row + the error response together tell the operator they
 *     need to apply the role manually.
 *  3. Call `callBot('squishy', 'staff.grant', { userId, roleKey })`. The
 *     `roleKey` comes out of `requested_data.role_key` (the bot stores it
 *     that way when the request modal submits — see
 *     `squishybot/src/interactions/modals/staffRequest.ts`). A missing /
 *     malformed `role_key` is a 422 so the operator knows to grant by
 *     hand and dismiss the row.
 *  4. Audit on both success and failure with `action: 'staff.approved'`.
 *     `after.grant` carries the bot's full reply so the audit log diff has
 *     enough context to triage a Discord-side error after the fact.
 *
 * Gating: sudo (not bot-owner-only) — the original spec is that bot-owner
 * is too narrow for the day-to-day approve/deny workflow. CSRF on,
 * rate-limited 30/min/actor (same envelope as every other Wave-6+ write).
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

type RouteCtx = { params: Promise<{ id: string }> }

function extractRoleKey(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null
  const d = data as Record<string, unknown>
  for (const key of ['role_key', 'roleKey']) {
    const v = d[key]
    if (typeof v === 'string' && v.length > 0) return v
  }
  return null
}

export const POST = withAuth<[RouteCtx]>(
  async (_req: NextRequest, access, ctx: RouteCtx) => {
    const { id } = await ctx.params

    if (!UUID_RE.test(id)) {
      await writeAudit({
        bot: 'squishy',
        action: 'staff.approved',
        targetType: 'staff_approvals',
        targetId: id,
        actor: access.actor, viewing: access.viewing,
        before: null, after: null,
        success: false,
        errorMessage: 'invalid-uuid',
      }).catch(() => {})
      return NextResponse.json({ error: 'id must be a UUID' }, { status: 400 })
    }

    // Read the current row so we can audit `before` and pull userId + roleKey.
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
      console.error('[staff-approvals/approve] read failed', err)
      await writeAudit({
        bot: 'squishy',
        action: 'staff.approved',
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

    const roleKey = extractRoleKey(before.requestedData)
    if (!roleKey) {
      await writeAudit({
        bot: 'squishy',
        action: 'staff.approved',
        targetType: 'staff_approvals',
        targetId: id,
        actor: access.actor, viewing: access.viewing,
        before, after: null,
        success: false,
        errorMessage: 'no-role-key-in-row',
      }).catch(() => {})
      return NextResponse.json(
        {
          error: 'no-role-key-in-row',
          errorMessage:
            'This row has no role_key in requested_data — grant the role manually and dismiss via the bot.',
        },
        { status: 422 },
      )
    }

    // Mark the row as granted FIRST. If the Discord grant fails downstream
    // we still want the queue cleared (the spec says: include the error in
    // the response so the operator can apply it by hand).
    const decidedAt = new Date()
    try {
      await squishyDb
        .update(squishySchema.staffApprovals)
        .set({
          status: 'granted',
          reviewedBy: access.actor.id,
          reviewedAt: decidedAt,
        })
        .where(eq(squishySchema.staffApprovals.id, id))
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown'
      console.error('[staff-approvals/approve] update failed', err)
      await writeAudit({
        bot: 'squishy',
        action: 'staff.approved',
        targetType: 'staff_approvals',
        targetId: id,
        actor: access.actor, viewing: access.viewing,
        before, after: null,
        success: false,
        errorMessage: msg,
      }).catch(() => {})
      return NextResponse.json({ error: 'db-write-failed' }, { status: 503 })
    }

    // Now attempt the Discord grant over the command bus.
    const grantReply = await callBot('squishy', 'staff.grant', {
      userId: before.userId,
      roleKey,
    })

    const after = {
      status: 'granted',
      reviewedBy: access.actor.id,
      reviewedAt: decidedAt.toISOString(),
      grant: grantReply,
    }

    await writeAudit({
      bot: 'squishy',
      action: 'staff.approved',
      targetType: 'staff_approvals',
      targetId: id,
      actor: access.actor, viewing: access.viewing,
      before, after,
      success: grantReply.ok,
      errorMessage: grantReply.ok ? null : grantReply.error,
    }).catch((err) => {
      console.warn('[staff-approvals/approve] audit failed (non-fatal)', err)
    })

    // Always 200 — the row IS updated; `grantOk` lets the UI surface the
    // partial-failure case ("queue cleared but Discord didn't apply the role").
    return NextResponse.json({
      success: true,
      id,
      status: 'granted',
      grantOk: grantReply.ok,
      grant: grantReply,
    })
  },
  {
    require: 'sudo',
    csrf: true,
    rateLimit: { points: 30, perSeconds: 60 },
  },
)

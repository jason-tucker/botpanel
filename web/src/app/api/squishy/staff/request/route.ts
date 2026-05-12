/**
 * POST /api/squishy/staff/request — self-service "Request a staff role"
 * from /me/edit. Any authenticated user can request a role for THEMSELVES;
 * the panel never lets a sudo file a request on someone else's behalf
 * (sudo grants the role directly via /sudo → Direct Grant). View-As is
 * intentionally ignored here — `actor.id` is what gets stamped on the
 * staff_approvals row.
 *
 * Request body: `{ departmentSlug?, tierSlug?, realName? }`. At least one
 * of `departmentSlug` / `tierSlug` must be present. The route validates
 * against `DEPARTMENT_SLUGS` / `TIER_SLUGS` before publishing to the bot.
 *
 * Routes through the `staff.request` RPC verb which inserts the row AND
 * posts the same Components V2 approval card to `STAFF_APPROVAL_THREAD_ID`
 * as the bot's slash flow. The panel only owns the auth boundary,
 * rate-limit, and audit hook.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { withAuth } from '@/lib/auth/middleware'
import { callBot } from '@/lib/botrpc'
import { writeAudit } from '@/lib/audit'
import { DEPARTMENT_SLUGS, TIER_SLUGS } from '@/lib/squishyStaffRoles'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = withAuth(
  async (req: NextRequest, access) => {
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
    }

    const b = body as
      | { departmentSlug?: unknown; tierSlug?: unknown; realName?: unknown }
      | null

    const auditBase = {
      bot: 'squishy' as const,
      action: 'staff.requested',
      targetType: 'staff_role',
      actor: access.actor,
      viewing: access.viewing,
    }

    // Normalize to string|null. The bot accepts empty string as "absent"
    // too, but we filter here so the audit row reflects what the user
    // really submitted.
    const deptSlug =
      typeof b?.departmentSlug === 'string' && b.departmentSlug.length > 0
        ? b.departmentSlug
        : null
    const tierSlug =
      typeof b?.tierSlug === 'string' && b.tierSlug.length > 0 ? b.tierSlug : null

    if (deptSlug === null && tierSlug === null) {
      await writeAudit({
        ...auditBase,
        targetId: '',
        before: null,
        after: null,
        success: false,
        errorMessage: 'no-selection',
      }).catch(() => {})
      return NextResponse.json(
        { error: 'no-selection', message: 'Pick a department or a tier (or both).' },
        { status: 400 },
      )
    }

    if (deptSlug !== null && !DEPARTMENT_SLUGS.has(deptSlug)) {
      await writeAudit({
        ...auditBase,
        targetId: deptSlug,
        before: null,
        after: null,
        success: false,
        errorMessage: 'invalid-department-slug',
      }).catch(() => {})
      return NextResponse.json(
        { error: 'invalid-department-slug', message: 'Unknown department.' },
        { status: 400 },
      )
    }

    if (tierSlug !== null && !TIER_SLUGS.has(tierSlug)) {
      await writeAudit({
        ...auditBase,
        targetId: tierSlug,
        before: null,
        after: null,
        success: false,
        errorMessage: 'invalid-tier-slug',
      }).catch(() => {})
      return NextResponse.json(
        { error: 'invalid-tier-slug', message: 'Unknown tier.' },
        { status: 400 },
      )
    }

    const realName =
      typeof b?.realName === 'string' && b.realName.trim()
        ? b.realName.trim().slice(0, 120)
        : null

    const reply = await callBot<{
      approvalId: string
      approvalMsgId: string | null
      departmentLabel: string | null
      tierLabel: string | null
    }>('squishy', 'staff.request', {
      userId: access.actor.id,
      departmentSlug: deptSlug,
      tierSlug: tierSlug,
      realName,
    })

    if (!reply.ok) {
      await writeAudit({
        ...auditBase,
        targetId: [deptSlug, tierSlug].filter(Boolean).join('+') || '',
        before: null,
        after: { departmentSlug: deptSlug, tierSlug, realName: realName !== null },
        success: false,
        errorMessage: reply.error,
      }).catch(() => {})
      const status =
        reply.error === 'timeout' || reply.error === 'rpc-not-configured' ? 503 : 400
      return NextResponse.json({ error: reply.error, details: reply.details }, { status })
    }

    await writeAudit({
      ...auditBase,
      targetId: reply.data.approvalId,
      before: null,
      after: {
        departmentSlug: deptSlug,
        departmentLabel: reply.data.departmentLabel,
        tierSlug,
        tierLabel: reply.data.tierLabel,
        approvalMsgId: reply.data.approvalMsgId,
        realName: realName !== null,
      },
      success: true,
    }).catch(() => {})

    return NextResponse.json({ ok: true, data: reply.data })
  },
  {
    require: 'any',
    csrf: true,
    rateLimit: { points: 5, perSeconds: 300 },
  },
)

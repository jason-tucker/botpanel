/**
 * POST /api/squishy/staff/request — self-service "Request a staff role"
 * from /me/edit. Any authenticated user can request a role for THEMSELVES;
 * the panel never lets a sudo file a request on someone else's behalf
 * (sudo grants the role directly via /sudo → Direct Grant). View-As is
 * intentionally ignored here — `actor.id` is what gets stamped on the
 * staff_approvals row.
 *
 * Routes through `staff.request` on the bot, which inserts the
 * staff_approvals row AND posts the approval card to the configured
 * thread. Panel only owns the auth boundary + rate limit + audit hook;
 * the DB write happens bot-side via the shared `staffRequestService`.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { withAuth } from '@/lib/auth/middleware'
import { callBot } from '@/lib/botrpc'
import { writeAudit } from '@/lib/audit'
import { STAFF_ROLE_SLUGS } from '@/lib/squishyStaffRoles'

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

    const b = body as { roleSlug?: unknown; realName?: unknown; reason?: unknown } | null
    const roleSlug = b?.roleSlug
    const realNameRaw = b?.realName
    const reasonRaw = b?.reason

    const auditBase = {
      bot: 'squishy' as const,
      action: 'staff.requested',
      targetType: 'staff_role',
      actor: access.actor,
      viewing: access.viewing,
    }

    if (typeof roleSlug !== 'string' || !STAFF_ROLE_SLUGS.has(roleSlug)) {
      await writeAudit({
        ...auditBase,
        targetId: typeof roleSlug === 'string' ? roleSlug : '',
        before: null,
        after: null,
        success: false,
        errorMessage: 'invalid-role-slug',
      }).catch(() => {})
      return NextResponse.json(
        {
          error: 'invalid-role-slug',
          message: 'roleSlug must be one of: ' + Array.from(STAFF_ROLE_SLUGS).join(', '),
        },
        { status: 400 },
      )
    }

    // Trim and length-cap server-side. Empty strings normalize to null
    // so the bot sees the same "absent" shape as the slash modal's
    // `getTextInputValue` returns for blanks.
    const realName =
      typeof realNameRaw === 'string' && realNameRaw.trim() ? realNameRaw.trim().slice(0, 120) : null
    const reason =
      typeof reasonRaw === 'string' && reasonRaw.trim() ? reasonRaw.trim().slice(0, 1000) : null

    const reply = await callBot<{
      approvalId: string
      approvalMsgId: string | null
      roleLabel: string
    }>('squishy', 'staff.request', {
      userId: access.actor.id,
      slug: roleSlug,
      realName,
      reason,
    })

    if (!reply.ok) {
      await writeAudit({
        ...auditBase,
        targetId: roleSlug,
        before: null,
        after: { roleSlug, realName: realName !== null, reason: reason !== null },
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
        roleSlug,
        roleLabel: reply.data.roleLabel,
        approvalMsgId: reply.data.approvalMsgId,
        realName: realName !== null,
        reason: reason !== null,
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

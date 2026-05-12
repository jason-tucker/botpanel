/**
 * POST /api/sudo/staff/revoke — direct revoke of a staff role from /sudo
 * admin home. Mirror of `/api/sudo/staff/grant` — same validation, same
 * envelope, swaps the bot verb to `staff.revoke` and the audit action to
 * `staff.direct_revoke`.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { withAuth } from '@/lib/auth/middleware'
import { writeAudit } from '@/lib/audit'
import { callBot } from '@/lib/botrpc'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SNOWFLAKE_RE = /^\d{15,25}$/

const STAFF_ROLE_SLUGS: ReadonlySet<string> = new Set([
  'tier_1',
  'tier_2',
  'tier_3',
  'help_desk',
  'onsites',
  'security',
  'sales',
  'leadership',
])

export const POST = withAuth(
  async (req: NextRequest, access) => {
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
    }

    const b = body as { userId?: unknown; roleKey?: unknown } | null
    const userId = b?.userId
    const roleKey = b?.roleKey

    if (typeof userId !== 'string' || !SNOWFLAKE_RE.test(userId)) {
      await writeAudit({
        bot: 'squishy',
        action: 'staff.direct_revoke',
        targetType: 'staff_role',
        targetId: typeof userId === 'string' ? userId : '',
        actor: access.actor, viewing: access.viewing,
        before: null, after: null,
        success: false,
        errorMessage: 'invalid-snowflake',
      }).catch(() => {})
      return NextResponse.json(
        { errorMessage: 'userId must be a Discord snowflake (15-25 digits)' },
        { status: 400 },
      )
    }

    if (typeof roleKey !== 'string' || !STAFF_ROLE_SLUGS.has(roleKey)) {
      await writeAudit({
        bot: 'squishy',
        action: 'staff.direct_revoke',
        targetType: 'staff_role',
        targetId: userId,
        actor: access.actor, viewing: access.viewing,
        before: null, after: null,
        success: false,
        errorMessage: 'invalid-role-key',
      }).catch(() => {})
      return NextResponse.json(
        {
          errorMessage:
            'roleKey must be one of: ' + Array.from(STAFF_ROLE_SLUGS).join(', '),
        },
        { status: 400 },
      )
    }

    const reply = await callBot('squishy', 'staff.revoke', { userId, roleKey })

    await writeAudit({
      bot: 'squishy',
      action: 'staff.direct_revoke',
      targetType: 'staff_role',
      targetId: userId,
      actor: access.actor, viewing: access.viewing,
      before: { userId, roleKey },
      after: { userId, roleKey, revoke: reply },
      success: reply.ok,
      errorMessage: reply.ok ? null : reply.error,
    }).catch((err) => {
      console.warn('[sudo/staff/revoke] audit failed (non-fatal)', err)
    })

    return NextResponse.json({ success: true, revokeOk: reply.ok, revoke: reply })
  },
  {
    require: 'sudo',
    csrf: true,
    rateLimit: { points: 30, perSeconds: 60 },
  },
)

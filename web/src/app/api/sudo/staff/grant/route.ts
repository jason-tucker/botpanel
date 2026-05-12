/**
 * POST /api/sudo/staff/grant — direct grant of a staff role from /sudo
 * admin home. Bypasses the queue entirely — for the "I already decided
 * offline, just give them the role" case.
 *
 * Body: `{ userId: string, roleKey: string }` — `userId` is a Discord
 * snowflake; `roleKey` is one of the hand-rolled slugs the panel select
 * exposes (`tier_1` … `leadership`). The bot side accepts both the full
 * `staff.role.*` key and the bare slug, so we pass the value through
 * unchanged — no need for the panel to know about the storage convention.
 *
 * Gating: sudo (same as approve/deny). CSRF on. Rate-limited 30/min/actor.
 * Audits `staff.direct_grant` on every attempt with the full bot reply
 * captured in `after`.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { withAuth } from '@/lib/auth/middleware'
import { writeAudit } from '@/lib/audit'
import { callBot } from '@/lib/botrpc'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SNOWFLAKE_RE = /^\d{15,25}$/

/**
 * Hand-rolled list mirroring `squishybot/src/services/staffRoles.ts`. The
 * panel doesn't import the bot's source — duplicating the list is the
 * documented trade-off until cross-repo schema sync covers TypeScript
 * constants too. Keep this aligned by hand.
 */
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
        action: 'staff.direct_grant',
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
        action: 'staff.direct_grant',
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

    const reply = await callBot('squishy', 'staff.grant', { userId, roleKey })

    await writeAudit({
      bot: 'squishy',
      action: 'staff.direct_grant',
      targetType: 'staff_role',
      targetId: userId,
      actor: access.actor, viewing: access.viewing,
      before: null,
      after: { userId, roleKey, grant: reply },
      success: reply.ok,
      errorMessage: reply.ok ? null : reply.error,
    }).catch((err) => {
      console.warn('[sudo/staff/grant] audit failed (non-fatal)', err)
    })

    // 200 either way — the bot reply carries `ok: true|false` for the UI
    // to surface a friendly error instead of HTTP-level confusion.
    return NextResponse.json({ success: true, grantOk: reply.ok, grant: reply })
  },
  {
    require: 'sudo',
    csrf: true,
    rateLimit: { points: 30, perSeconds: 60 },
  },
)

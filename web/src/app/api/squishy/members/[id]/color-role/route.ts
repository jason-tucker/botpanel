/**
 * POST /api/squishy/members/[id]/color-role — set/clear a curated color
 * role for a target member.
 *
 * Body: `{ roleKey: string | null }` — `null` clears every curated color
 * role; a non-null value must match a row in `color_roles` for the
 * configured guild (the bot re-validates this).
 *
 * Gating: sudo OR bot-owner. Plus a server-side feature-flag check on
 * `feature.color_roles` — if the flag is off, the route refuses with
 * `feature-disabled`. The drill-down UI also hides the Color Role
 * section entirely when the flag is off so this should never fire in
 * normal use.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { withAuth } from '@/lib/auth/middleware'
import { writeAudit } from '@/lib/audit'
import { callBot } from '@/lib/botrpc'
import { squishyDb, squishySchema } from '@/lib/db/squishy'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SNOWFLAKE_RE = /^\d{15,25}$/

async function isFeatureOn(): Promise<boolean> {
  try {
    const rows = await squishyDb
      .select({ value: squishySchema.botSettings.value })
      .from(squishySchema.botSettings)
      .where(eq(squishySchema.botSettings.key, 'feature.color_roles'))
      .limit(1)
    const v = rows[0]?.value
    if (typeof v !== 'string') return false
    return v === 'true' || v === '1' || v === 'on'
  } catch (err) {
    console.warn('[members/color-role] feature flag read failed', err)
    return false
  }
}

export const POST = withAuth(
  async (
    req: NextRequest,
    access,
    ctx: { params: Promise<{ id: string }> },
  ) => {
    const { id } = await ctx.params
    const targetUserId = (id ?? '').trim()
    if (!SNOWFLAKE_RE.test(targetUserId)) {
      return NextResponse.json(
        { error: 'id must be a Discord snowflake (15-25 digits)' },
        { status: 400 },
      )
    }

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
    }
    const rawKey = (body as { roleKey?: unknown } | null)?.roleKey
    let roleKey: string | null
    if (rawKey === null) {
      roleKey = null
    } else if (typeof rawKey === 'string') {
      const trimmed = rawKey.trim()
      // Empty string is treated as "clear" — the form sends "" for the
      // Clear button rather than mapping it to null on the client.
      if (trimmed.length === 0) roleKey = null
      else if (!SNOWFLAKE_RE.test(trimmed)) {
        return NextResponse.json(
          { error: 'roleKey must be a Discord role id or null' },
          { status: 400 },
        )
      } else {
        roleKey = trimmed
      }
    } else {
      return NextResponse.json(
        { error: 'roleKey must be a string or null' },
        { status: 400 },
      )
    }

    if (!(await isFeatureOn())) {
      await writeAudit({
        bot: 'squishy',
        actor: access.actor,
        viewing: { id: targetUserId, username: access.viewing.username },
        action: 'member.color_set',
        targetType: 'user_color_role',
        targetId: targetUserId,
        success: false,
        errorMessage: 'feature-disabled',
      }).catch(() => {})
      return NextResponse.json(
        { error: 'feature-disabled', details: 'feature.color_roles is off' },
        { status: 409 },
      )
    }

    // 20s timeout: color.assign does member.fetch + remove-current-color
    // + add-new-color on Discord. Same posture as staff.grant/revoke.
    const reply = await callBot<{ userId: string; roleKey: string | null; applied: boolean }>(
      'squishy',
      'color.assign',
      { userId: targetUserId, roleKey },
      { timeoutMs: 20_000 },
    )

    if (!reply.ok) {
      await writeAudit({
        bot: 'squishy',
        actor: access.actor,
        viewing: { id: targetUserId, username: access.viewing.username },
        action: 'member.color_set',
        targetType: 'user_color_role',
        targetId: targetUserId,
        after: { roleKey },
        success: false,
        errorMessage: reply.error,
      }).catch(() => {})
      const status =
        reply.error === 'timeout' || reply.error === 'rpc-not-configured' ? 503 : 400
      return NextResponse.json({ error: reply.error, details: reply.details }, { status })
    }

    await writeAudit({
      bot: 'squishy',
      actor: access.actor,
      viewing: { id: targetUserId, username: access.viewing.username },
      action: 'member.color_set',
      targetType: 'user_color_role',
      targetId: targetUserId,
      after: { roleKey, applied: reply.data.applied },
      success: true,
    }).catch(() => {})

    return NextResponse.json({ ok: true, data: reply.data })
  },
  {
    require: 'sudo',
    csrf: true,
    rateLimit: { points: 30, perSeconds: 60 },
  },
)

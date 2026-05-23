/**
 * POST /api/squishy/reaction-roles/[id]/expire — force early expiry of a
 * temporary reaction-role message.
 *
 * Same teardown as the sibling /delete route, but routed to the bot's
 * `rxnroles.expire` verb so the bot's log line records `action:'expired'`
 * (vs `action:'deleted'`). Lets operator forensics tell "I pulled this
 * down" from "I made its timer fire early". Useful for game-night
 * messages whose timer was set too far out.
 *
 * Mirrors /delete in every other respect: looks up the message snowflake
 * from the row PK, calls the bot, writes an audit row, surfaces the
 * bot's machine-readable error to the UI. Sudo + CSRF + 10/min rate
 * limit. Gating decision intentionally matches /delete — same blast
 * radius (the Discord message is torn down either way).
 */
import { NextResponse, type NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { withAuth } from '@/lib/auth/middleware'
import { writeAudit } from '@/lib/audit'
import { squishyDb } from '@/lib/db/squishy'
import { reactionRoleMessages } from '@/lib/db/schema/squishy'
import { callBot } from '@/lib/botrpc'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const POST = withAuth(
  async (
    _req: NextRequest,
    access,
    ctx: { params: Promise<{ id: string }> },
  ) => {
    const { id } = await ctx.params
    const rowId = (id ?? '').trim()

    if (!UUID_RE.test(rowId)) {
      await writeAudit({
        bot: 'squishy',
        action: 'rxnroles.expired',
        actor: access.actor,
        viewing: access.viewing,
        targetType: 'reaction_role_messages',
        targetId: rowId,
        success: false,
        errorMessage: 'invalid-uuid',
      }).catch(() => {})
      return NextResponse.json(
        { error: 'id must be a UUID' },
        { status: 400 },
      )
    }

    let row: { messageId: string; channelId: string } | undefined
    try {
      const rows = await squishyDb
        .select({
          messageId: reactionRoleMessages.messageId,
          channelId: reactionRoleMessages.channelId,
        })
        .from(reactionRoleMessages)
        .where(eq(reactionRoleMessages.id, rowId))
      row = rows[0]
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown'
      console.error('[reaction-roles expire] db lookup failed', err)
      await writeAudit({
        bot: 'squishy',
        action: 'rxnroles.expired',
        actor: access.actor,
        viewing: access.viewing,
        targetType: 'reaction_role_messages',
        targetId: rowId,
        success: false,
        errorMessage: msg,
      }).catch(() => {})
      return NextResponse.json({ error: 'db-lookup-failed' }, { status: 503 })
    }

    if (!row) {
      await writeAudit({
        bot: 'squishy',
        action: 'rxnroles.expired',
        actor: access.actor,
        viewing: access.viewing,
        targetType: 'reaction_role_messages',
        targetId: rowId,
        success: false,
        errorMessage: 'not-found',
      }).catch(() => {})
      return NextResponse.json({ error: 'not found' }, { status: 404 })
    }

    const reply = await callBot('squishy', 'rxnroles.expire', {
      messageId: row.messageId,
    })

    if (!reply.ok) {
      const status = reply.error === 'not-found' ? 404 : 502
      await writeAudit({
        bot: 'squishy',
        action: 'rxnroles.expired',
        actor: access.actor,
        viewing: access.viewing,
        targetType: 'reaction_role_messages',
        targetId: rowId,
        before: { messageId: row.messageId, channelId: row.channelId },
        success: false,
        errorMessage: reply.error,
      }).catch(() => {})
      return NextResponse.json(
        { error: reply.error, details: reply.details ?? null },
        { status },
      )
    }

    await writeAudit({
      bot: 'squishy',
      action: 'rxnroles.expired',
      actor: access.actor,
      viewing: access.viewing,
      targetType: 'reaction_role_messages',
      targetId: rowId,
      before: { messageId: row.messageId, channelId: row.channelId },
      after: null,
      success: true,
    }).catch((err) => {
      console.warn('[reaction-roles expire] audit write failed', err)
    })

    return NextResponse.json({ ok: true })
  },
  {
    require: 'sudo',
    csrf: true,
    rateLimit: { points: 10, perSeconds: 60 },
  },
)

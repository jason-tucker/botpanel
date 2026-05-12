/**
 * POST /api/squishy/reaction-roles/[id]/delete — tear down a
 * reaction-role message via the bot.
 *
 * `[id]` is the `reaction_role_messages.id` UUID (the panel's stable
 * handle on the row). We resolve the `message_id` snowflake here and
 * hand THAT to the bot — the bot keys its in-memory cache on the
 * Discord message ID, so the verb signature is `{messageId}`.
 *
 * Why a `/delete` subpath instead of a top-level `DELETE` verb on
 * `/[id]`: keeps the panel-side ServerForm flow simple (it can POST
 * a regular form with `_format=json` rather than have to set `method:
 * 'DELETE'`). Matches the pattern other "this is a server-side mutation
 * with side-effects in Discord" routes will use in Wave 7+ (where the
 * usual REST-style DELETE feels misleading — there's a Discord message
 * being deleted, not just a DB row).
 *
 * Gating: sudo + CSRF + 10/min rate limit. The bot deletes the Discord
 * message + DB rows in one go, so we don't pre-clear the DB here — if
 * the bot RPC fails the DB row stays so the operator can retry. On
 * success the read-only tab will reflect the removal on next refetch.
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

// `id` is a UUID — looser than snowflake. We don't want to be strict on
// the exact UUID format (drizzle-orm + pg accept several stringifications)
// so just check it's reasonably shaped before we send it to the DB.
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
        action: 'rxnroles.deleted',
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

    // Look up the message snowflake from the row PK. We do this in the
    // panel rather than asking the bot to support a "delete by row ID"
    // verb because the bot's in-memory cache is keyed on `messageId`,
    // not on the DB PK — and the bot shouldn't have to learn the
    // panel's table layout.
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
      console.error('[reaction-roles delete] db lookup failed', err)
      await writeAudit({
        bot: 'squishy',
        action: 'rxnroles.deleted',
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
        action: 'rxnroles.deleted',
        actor: access.actor,
        viewing: access.viewing,
        targetType: 'reaction_role_messages',
        targetId: rowId,
        success: false,
        errorMessage: 'not-found',
      }).catch(() => {})
      return NextResponse.json({ error: 'not found' }, { status: 404 })
    }

    const reply = await callBot('squishy', 'rxnroles.delete', {
      messageId: row.messageId,
    })

    if (!reply.ok) {
      // `not-found` from the bot means its cache (and therefore the DB
      // row it manages) doesn't carry this message — almost certainly
      // a race with another operator clicking Delete. Treat as 404 so
      // the UI shows "already removed".
      const status = reply.error === 'not-found' ? 404 : 502
      await writeAudit({
        bot: 'squishy',
        action: 'rxnroles.deleted',
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
      action: 'rxnroles.deleted',
      actor: access.actor,
      viewing: access.viewing,
      targetType: 'reaction_role_messages',
      targetId: rowId,
      before: { messageId: row.messageId, channelId: row.channelId },
      after: null,
      success: true,
    }).catch((err) => {
      console.warn('[reaction-roles delete] audit write failed', err)
    })

    return NextResponse.json({ ok: true })
  },
  {
    require: 'sudo',
    csrf: true,
    rateLimit: { points: 10, perSeconds: 60 },
  },
)

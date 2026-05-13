/**
 * POST /api/squishy/members/[id]/sudo — toggle a member's sudo bit.
 *
 * Body: `{ enabled: boolean, note?: string }`.
 *   - `enabled: true` inserts into `sudo_users` (idempotent — re-toggling
 *     an existing row is a noop success).
 *   - `enabled: false` deletes the row (if present). Env-source grants
 *     (`SUDO_USER_IDS`) are operator-only and can't be touched here; the
 *     /sudo Members editor surfaces that via a disabled-state pill.
 *
 * Gating: bot-owner OR squishy sudo per the editor plan. Re-uses the
 * same `sudo_users` table the existing `/api/sudo/users` routes own; we
 * could have re-posted to those routes from the panel client, but those
 * routes are owner-only and we want the broader sudo→sudo flow to work
 * here too. Audited as `member.sudo_toggled` with before/after JSON
 * snapshots of the row.
 *
 * Side-effect on success: invokes `admin.reload_caches` so the bot picks
 * up the new sudo entry without a process restart — the bot caches sudo
 * lookups in memory and would otherwise show stale auth for up to one
 * cache TTL.
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
    const enabled = (body as { enabled?: unknown } | null)?.enabled
    if (typeof enabled !== 'boolean') {
      return NextResponse.json(
        { error: 'enabled must be boolean' },
        { status: 400 },
      )
    }
    const noteRaw = (body as { note?: unknown } | null)?.note
    const note =
      typeof noteRaw === 'string' && noteRaw.trim().length > 0
        ? noteRaw.trim().slice(0, 200)
        : null

    // Read the current row so the audit row has an honest before/after.
    let before:
      | { userId: string; addedByDiscordId: string | null; note: string | null }
      | null = null
    try {
      const rows = await squishyDb
        .select({
          userId: squishySchema.sudoUsers.userId,
          addedByDiscordId: squishySchema.sudoUsers.addedByDiscordId,
          note: squishySchema.sudoUsers.note,
        })
        .from(squishySchema.sudoUsers)
        .where(eq(squishySchema.sudoUsers.userId, targetUserId))
        .limit(1)
      before = rows[0] ?? null
    } catch (err) {
      console.warn('[members/sudo POST] read-before failed', err)
    }

    try {
      let after:
        | { userId: string; addedByDiscordId: string | null; note: string | null }
        | null = before
      let mutated = false
      if (enabled) {
        if (!before) {
          const inserted = await squishyDb
            .insert(squishySchema.sudoUsers)
            .values({
              userId: targetUserId,
              addedByDiscordId: access.actor.id,
              note,
            })
            .onConflictDoNothing({ target: squishySchema.sudoUsers.userId })
            .returning()
          after = inserted[0]
            ? {
                userId: inserted[0].userId,
                addedByDiscordId: inserted[0].addedByDiscordId,
                note: inserted[0].note,
              }
            : before
          mutated = inserted.length > 0
        }
      } else {
        if (before) {
          await squishyDb
            .delete(squishySchema.sudoUsers)
            .where(eq(squishySchema.sudoUsers.userId, targetUserId))
          after = null
          mutated = true
        }
      }

      // Fire-and-forget cache reload — the bot's in-memory `sudo_users`
      // cache otherwise stays stale until its TTL elapses. We don't block
      // the response on this (or treat its failure as a route failure)
      // because the DB write is the source of truth and the cache is a
      // best-effort optimization.
      if (mutated) {
        void callBot('squishy', 'admin.reload_caches', {}).catch(() => {})
      }

      await writeAudit({
        bot: 'squishy',
        actor: access.actor,
        viewing: { id: targetUserId, username: access.viewing.username },
        action: 'member.sudo_toggled',
        targetType: 'sudo_users',
        targetId: targetUserId,
        before,
        after,
        success: true,
      }).catch(() => {})

      return NextResponse.json({
        ok: true,
        data: { userId: targetUserId, enabled, mutated },
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown'
      console.error('[members/sudo POST] db write failed', err)
      await writeAudit({
        bot: 'squishy',
        actor: access.actor,
        viewing: { id: targetUserId, username: access.viewing.username },
        action: 'member.sudo_toggled',
        targetType: 'sudo_users',
        targetId: targetUserId,
        before,
        after: null,
        success: false,
        errorMessage: msg,
      }).catch(() => {})
      return NextResponse.json({ error: 'db-write-failed' }, { status: 503 })
    }
  },
  {
    require: 'sudo',
    csrf: true,
    rateLimit: { points: 30, perSeconds: 60 },
  },
)

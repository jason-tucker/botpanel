/**
 * POST /api/sudo/users — grant runtime sudo to a Discord user id.
 *
 * Gate: **bot owner only** (`require: 'botOwner'`). Sudo users can't grant
 * sudo — escalation is owner-mediated. CSRF on; rate-limited 10/min/actor
 * because grants should be deliberate, not a typing exercise.
 *
 * Body: `{ userId: string }` matching the Discord snowflake shape
 * `/^\d{15,25}$/` (snowflakes are typically 17-19 digits but the window is
 * intentionally loose to survive Discord widening the format later).
 *
 * Semantics: idempotent — `ON CONFLICT (user_id) DO NOTHING`. Calling this
 * twice with the same id returns `{ ok:true, granted:false }` on the second
 * call so the UI can refresh without flashing an error.
 *
 * Audit: every success and every failure writes `sudo.granted` via
 * `writeAudit`. `before` is null (we're granting) and `after` is the row
 * we just inserted (or `null` if a noop because the row was already there).
 *
 * NB: this table is *additive* to `SUDO_USER_IDS` env. Env-source grants
 * can't be revoked here — operators have to edit `.env` and restart. The
 * `/sudo` page makes the source visible via the env/db pills.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { withAuth } from '@/lib/auth/middleware'
import { writeAudit } from '@/lib/audit'
import { squishyDb, squishySchema } from '@/lib/db/squishy'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SNOWFLAKE_RE = /^\d{15,25}$/

export const POST = withAuth(
  async (req: NextRequest, access) => {
    const actor = access.actor.id

    let body: unknown
    try {
      body = await req.json()
    } catch {
      await writeAudit({
        bot: 'squishy',
        action: 'sudo.granted',
        targetType: 'sudo_users',
        targetId: '',
        actorDiscordId: actor,
        before: null,
        after: null,
        ok: false,
        error: 'invalid-json',
      }).catch(() => {})
      return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
    }

    const userId = (body as { userId?: unknown } | null)?.userId
    if (typeof userId !== 'string' || !SNOWFLAKE_RE.test(userId)) {
      await writeAudit({
        bot: 'squishy',
        action: 'sudo.granted',
        targetType: 'sudo_users',
        targetId: typeof userId === 'string' ? userId : '',
        actorDiscordId: actor,
        before: null,
        after: null,
        ok: false,
        error: 'invalid-snowflake',
      }).catch(() => {})
      return NextResponse.json(
        { error: 'userId must be a Discord snowflake (15-25 digits)' },
        { status: 400 },
      )
    }

    try {
      const inserted = await squishyDb
        .insert(squishySchema.sudoUsers)
        .values({
          userId,
          addedByDiscordId: actor,
          addedAt: new Date(),
        })
        .onConflictDoNothing({ target: squishySchema.sudoUsers.userId })
        .returning()

      const granted = inserted.length > 0

      await writeAudit({
        bot: 'squishy',
        action: 'sudo.granted',
        targetType: 'sudo_users',
        targetId: userId,
        actorDiscordId: actor,
        before: null,
        after: granted
          ? { userId, addedByDiscordId: actor }
          : { userId, alreadyPresent: true },
        ok: true,
      }).catch((err) => {
        console.warn('[sudo/users POST] audit write failed (insert succeeded)', err)
      })

      return NextResponse.json({ ok: true, userId, granted })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown'
      console.error('[sudo/users POST] DB write failed', err)
      await writeAudit({
        bot: 'squishy',
        action: 'sudo.granted',
        targetType: 'sudo_users',
        targetId: userId,
        actorDiscordId: actor,
        before: null,
        after: null,
        ok: false,
        error: msg,
      }).catch(() => {})
      return NextResponse.json({ error: 'db-write-failed' }, { status: 503 })
    }
  },
  {
    require: 'botOwner',
    csrf: true,
    rateLimit: { points: 10, perSeconds: 60 },
  },
)

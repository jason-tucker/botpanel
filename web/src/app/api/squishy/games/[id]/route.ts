/**
 * `/api/squishy/games/[id]` — per-row edit/remove for the games CRUD.
 *
 *  - PATCH `{ name?, channelId?, roleId?, pingRoleId?, playCooldownSeconds?,
 *            autoArchiveDays? }` — partial update. A field set to `null` /
 *            empty string explicitly clears the column; an omitted field is
 *            left alone. 400 if no fields are present (caller probably
 *            meant DELETE); 404 if the row doesn't exist.
 *  - DELETE — drop the row AND cascade-delete the matching `user_game_prefs`
 *            rows in the same SQL transaction so the FK doesn't dangle for
 *            consumers that don't follow `ON DELETE CASCADE` (e.g. raw
 *            metrics jobs). The schema FK *is* `ON DELETE CASCADE` but doing
 *            the prefs DELETE explicitly gives us a row-count for the audit
 *            row and a single atomic point of failure.
 *
 * After every successful write we fire-and-forget `callBot('squishy',
 * 'games.refresh_cache', {})` so the bot reloads its in-memory catalog.
 * A bot/RPC failure does NOT fail the response — DB is authoritative.
 *
 * Gating: sudo via `withAuth({require:'sudo'})`. CSRF + 30/min rate limit
 * handled by the wrapper. Audit on success AND failure.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { withAuth } from '@/lib/auth/middleware'
import { writeAudit } from '@/lib/audit'
import { squishyDb, squishySchema } from '@/lib/db/squishy'
import { callBot } from '@/lib/botrpc'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SNOWFLAKE_RE = /^\d{15,25}$/
const MAX_NAME_LEN = 100
const MAX_INT = 365 * 24 * 60 * 60

type RawBody = {
  name?: unknown
  channelId?: unknown
  roleId?: unknown
  pingRoleId?: unknown
  playCooldownSeconds?: unknown
  autoArchiveDays?: unknown
}

/**
 * Parse a nullable-snowflake patch field.
 *
 *   undefined / missing -> leave the column alone (returns `present:false`)
 *   null / ''           -> explicitly clear the column
 *   '<snowflake>'       -> set the column
 *   anything else       -> error
 */
function parsePatchSnowflake(
  raw: unknown,
):
  | { present: false }
  | { present: true; ok: true; value: string | null }
  | { present: true; ok: false; error: string } {
  if (raw === undefined) return { present: false }
  if (raw === null) return { present: true, ok: true, value: null }
  if (typeof raw !== 'string') {
    return { present: true, ok: false, error: 'must be a string or null' }
  }
  const trimmed = raw.trim()
  if (trimmed === '') return { present: true, ok: true, value: null }
  if (!SNOWFLAKE_RE.test(trimmed)) {
    return {
      present: true,
      ok: false,
      error: 'must be a Discord snowflake (15-25 digits)',
    }
  }
  return { present: true, ok: true, value: trimmed }
}

function parsePatchInt(
  raw: unknown,
):
  | { present: false }
  | { present: true; ok: true; value: number | null }
  | { present: true; ok: false; error: string } {
  if (raw === undefined) return { present: false }
  if (raw === null || raw === '') {
    return { present: true, ok: true, value: null }
  }
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (
    typeof n !== 'number' ||
    !Number.isFinite(n) ||
    !Number.isInteger(n) ||
    n < 0 ||
    n > MAX_INT
  ) {
    return {
      present: true,
      ok: false,
      error: `must be a non-negative integer ≤ ${MAX_INT}`,
    }
  }
  return { present: true, ok: true, value: n }
}

async function refreshBotCache(context: string): Promise<void> {
  try {
    const reply = await callBot('squishy', 'games.refresh_cache', {})
    if (!reply.ok) {
      console.warn(`[${context}] games.refresh_cache RPC returned`, reply)
    }
  } catch (err) {
    console.warn(`[${context}] games.refresh_cache RPC threw`, err)
  }
}

export const PATCH = withAuth(
  async (
    req: NextRequest,
    access,
    ctx: { params: Promise<{ id: string }> },
  ) => {
    const { id } = await ctx.params
    const gameId = (id ?? '').trim()
    if (!UUID_RE.test(gameId)) {
      await writeAudit({
        bot: 'squishy',
        action: 'game.updated',
        actor: access.actor,
        viewing: access.viewing,
        targetType: 'games',
        targetId: gameId,
        success: false,
        errorMessage: 'invalid-uuid',
      }).catch(() => {})
      return NextResponse.json({ error: 'id must be a UUID' }, { status: 400 })
    }

    let body: RawBody
    try {
      body = ((await req.json()) ?? {}) as RawBody
    } catch {
      return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
    }

    const patch: {
      name?: string
      channelId?: string | null
      roleId?: string | null
      pingRoleId?: string | null
      playCooldownSeconds?: number | null
      autoArchiveDays?: number | null
    } = {}

    if (body.name !== undefined) {
      if (typeof body.name !== 'string') {
        return NextResponse.json(
          { error: 'name must be a string' },
          { status: 400 },
        )
      }
      const trimmed = body.name.trim()
      if (trimmed.length === 0 || trimmed.length > MAX_NAME_LEN) {
        return NextResponse.json(
          { error: `name must be 1-${MAX_NAME_LEN} chars` },
          { status: 400 },
        )
      }
      patch.name = trimmed
    }

    for (const f of ['channelId', 'roleId', 'pingRoleId'] as const) {
      const r = parsePatchSnowflake(body[f])
      if (r.present) {
        if (!r.ok) {
          return NextResponse.json(
            { error: `${f} ${r.error}` },
            { status: 400 },
          )
        }
        patch[f] = r.value
      }
    }
    for (const f of ['playCooldownSeconds', 'autoArchiveDays'] as const) {
      const r = parsePatchInt(body[f])
      if (r.present) {
        if (!r.ok) {
          return NextResponse.json(
            { error: `${f} ${r.error}` },
            { status: 400 },
          )
        }
        patch[f] = r.value
      }
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json(
        { error: 'no fields to patch — supply at least one field' },
        { status: 400 },
      )
    }

    try {
      const existing = await squishyDb
        .select()
        .from(squishySchema.games)
        .where(eq(squishySchema.games.id, gameId))
      if (existing.length === 0) {
        await writeAudit({
          bot: 'squishy',
          action: 'game.updated',
          actor: access.actor,
          viewing: access.viewing,
          targetType: 'games',
          targetId: gameId,
          success: false,
          errorMessage: 'not-found',
        }).catch(() => {})
        return NextResponse.json({ error: 'not found' }, { status: 404 })
      }

      const updated = await squishyDb
        .update(squishySchema.games)
        .set(patch)
        .where(eq(squishySchema.games.id, gameId))
        .returning()

      await writeAudit({
        bot: 'squishy',
        action: 'game.updated',
        actor: access.actor,
        viewing: access.viewing,
        targetType: 'games',
        targetId: gameId,
        before: existing[0],
        after: updated[0],
        success: true,
      }).catch((err) => {
        console.warn('[games PATCH] audit write failed', err)
      })

      void refreshBotCache('games PATCH')

      return NextResponse.json({ ok: true, id: gameId, row: updated[0] })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown'
      console.error('[games PATCH] db write failed', err)
      await writeAudit({
        bot: 'squishy',
        action: 'game.updated',
        actor: access.actor,
        viewing: access.viewing,
        targetType: 'games',
        targetId: gameId,
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

export const DELETE = withAuth(
  async (
    _req: NextRequest,
    access,
    ctx: { params: Promise<{ id: string }> },
  ) => {
    const { id } = await ctx.params
    const gameId = (id ?? '').trim()
    if (!UUID_RE.test(gameId)) {
      await writeAudit({
        bot: 'squishy',
        action: 'game.removed',
        actor: access.actor,
        viewing: access.viewing,
        targetType: 'games',
        targetId: gameId,
        success: false,
        errorMessage: 'invalid-uuid',
      }).catch(() => {})
      return NextResponse.json({ error: 'id must be a UUID' }, { status: 400 })
    }

    try {
      // Single transaction: clean up user_game_prefs first (the column has
      // ON DELETE CASCADE, but doing it explicitly gives us a count for
      // the audit row and keeps the whole operation atomic).
      const result = await squishyDb.transaction(async (tx) => {
        const existing = await tx
          .select()
          .from(squishySchema.games)
          .where(eq(squishySchema.games.id, gameId))
        if (existing.length === 0) {
          return { found: false as const }
        }
        const removedPrefs = await tx
          .delete(squishySchema.userGamePrefs)
          .where(eq(squishySchema.userGamePrefs.gameId, gameId))
          .returning({ id: squishySchema.userGamePrefs.id })
        const removed = await tx
          .delete(squishySchema.games)
          .where(eq(squishySchema.games.id, gameId))
          .returning()
        return {
          found: true as const,
          before: existing[0],
          removedRow: removed[0],
          prefsCleared: removedPrefs.length,
        }
      })

      if (!result.found) {
        await writeAudit({
          bot: 'squishy',
          action: 'game.removed',
          actor: access.actor,
          viewing: access.viewing,
          targetType: 'games',
          targetId: gameId,
          success: false,
          errorMessage: 'not-found',
        }).catch(() => {})
        return NextResponse.json({ error: 'not found' }, { status: 404 })
      }

      await writeAudit({
        bot: 'squishy',
        action: 'game.removed',
        actor: access.actor,
        viewing: access.viewing,
        targetType: 'games',
        targetId: gameId,
        before: result.before,
        after: { prefsCleared: result.prefsCleared },
        success: true,
      }).catch((err) => {
        console.warn('[games DELETE] audit write failed', err)
      })

      void refreshBotCache('games DELETE')

      return NextResponse.json({
        ok: true,
        id: gameId,
        prefsCleared: result.prefsCleared,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown'
      console.error('[games DELETE] db delete failed', err)
      await writeAudit({
        bot: 'squishy',
        action: 'game.removed',
        actor: access.actor,
        viewing: access.viewing,
        targetType: 'games',
        targetId: gameId,
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

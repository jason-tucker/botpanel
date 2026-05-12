/**
 * POST /api/squishy/games — add a row to the SquishyBot `games` table.
 *
 * Body: `{ name: string, channelId?: string|null, roleId?: string|null,
 *          pingRoleId?: string|null, playCooldownSeconds?: number|null,
 *          autoArchiveDays?: number|null }`.
 *
 * `name` is required and 1..100 chars after trim; the snowflake fields are
 * optional and must look like Discord snowflakes (15..25 digits) if present;
 * the numeric fields are optional non-negative integers. Anything missing
 * stays null in the row — the bot's `loadGames()` is happy with nulls and
 * the sudo-side `/sudo → Settings → Games` flow fills them in later if the
 * panel-side operator didn't.
 *
 * After a successful INSERT we fire-and-forget `callBot('squishy',
 * 'games.refresh_cache', {})` so the bot reloads its in-memory catalog —
 * but we do NOT fail the write if the RPC times out / errors. The DB is
 * authoritative; an out-of-sync cache will heal on the next bot restart
 * or the next time someone touches Sudo Debug → "Force-clear caches".
 *
 * Gating: sudo via `withAuth({require:'sudo'})`. CSRF + 30/min rate limit
 * handled by the wrapper. Schema gotcha: `games.guildId` is NOT NULL — we
 * refuse with `GUILD_ID-unset` (500) when the panel env doesn't pin a guild.
 *
 * Audit action: `game.added`.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { withAuth } from '@/lib/auth/middleware'
import { writeAudit } from '@/lib/audit'
import { squishyDb, squishySchema } from '@/lib/db/squishy'
import { env } from '@/lib/env'
import { callBot } from '@/lib/botrpc'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SNOWFLAKE_RE = /^\d{15,25}$/
const MAX_NAME_LEN = 100
const MAX_INT = 365 * 24 * 60 * 60 // one year in seconds — generous upper bound

type RawBody = {
  name?: unknown
  channelId?: unknown
  roleId?: unknown
  pingRoleId?: unknown
  playCooldownSeconds?: unknown
  autoArchiveDays?: unknown
}

type SnowflakeField = 'channelId' | 'roleId' | 'pingRoleId'
type IntField = 'playCooldownSeconds' | 'autoArchiveDays'

function parseOptionalSnowflake(
  raw: unknown,
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, value: null }
  if (typeof raw !== 'string') {
    return { ok: false, error: 'must be a string or null' }
  }
  const trimmed = raw.trim()
  if (trimmed === '') return { ok: true, value: null }
  if (!SNOWFLAKE_RE.test(trimmed)) {
    return { ok: false, error: 'must be a Discord snowflake (15-25 digits)' }
  }
  return { ok: true, value: trimmed }
}

function parseOptionalInt(
  raw: unknown,
): { ok: true; value: number | null } | { ok: false; error: string } {
  if (raw === undefined || raw === null || raw === '') {
    return { ok: true, value: null }
  }
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (
    typeof n !== 'number' ||
    !Number.isFinite(n) ||
    !Number.isInteger(n) ||
    n < 0 ||
    n > MAX_INT
  ) {
    return { ok: false, error: `must be a non-negative integer ≤ ${MAX_INT}` }
  }
  return { ok: true, value: n }
}

/**
 * Best-effort cache-refresh hook. Never throws and never blocks the response
 * status — DB is authoritative. Logs only if the RPC reply is `ok:false`.
 */
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

export const POST = withAuth(
  async (req: NextRequest, access) => {
    let body: RawBody
    try {
      body = ((await req.json()) ?? {}) as RawBody
    } catch {
      await writeAudit({
        bot: 'squishy',
        action: 'game.added',
        actor: access.actor,
        viewing: access.viewing,
        targetType: 'games',
        success: false,
        errorMessage: 'invalid-json',
      }).catch(() => {})
      return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
    }

    const rawName = typeof body.name === 'string' ? body.name.trim() : ''
    if (rawName.length === 0 || rawName.length > MAX_NAME_LEN) {
      await writeAudit({
        bot: 'squishy',
        action: 'game.added',
        actor: access.actor,
        viewing: access.viewing,
        targetType: 'games',
        success: false,
        errorMessage: 'invalid-name',
      }).catch(() => {})
      return NextResponse.json(
        { error: `name must be 1-${MAX_NAME_LEN} chars` },
        { status: 400 },
      )
    }

    const snowflakeFields: SnowflakeField[] = ['channelId', 'roleId', 'pingRoleId']
    const intFields: IntField[] = ['playCooldownSeconds', 'autoArchiveDays']

    const parsed: {
      channelId: string | null
      roleId: string | null
      pingRoleId: string | null
      playCooldownSeconds: number | null
      autoArchiveDays: number | null
    } = {
      channelId: null,
      roleId: null,
      pingRoleId: null,
      playCooldownSeconds: null,
      autoArchiveDays: null,
    }

    for (const f of snowflakeFields) {
      const r = parseOptionalSnowflake(body[f])
      if (!r.ok) {
        return NextResponse.json({ error: `${f} ${r.error}` }, { status: 400 })
      }
      parsed[f] = r.value
    }
    for (const f of intFields) {
      const r = parseOptionalInt(body[f])
      if (!r.ok) {
        return NextResponse.json({ error: `${f} ${r.error}` }, { status: 400 })
      }
      parsed[f] = r.value
    }

    if (!env.GUILD_ID) {
      await writeAudit({
        bot: 'squishy',
        action: 'game.added',
        actor: access.actor,
        viewing: access.viewing,
        targetType: 'games',
        success: false,
        errorMessage: 'GUILD_ID-unset',
      }).catch(() => {})
      return NextResponse.json(
        { error: 'GUILD_ID is not configured' },
        { status: 500 },
      )
    }

    try {
      const inserted = await squishyDb
        .insert(squishySchema.games)
        .values({
          guildId: env.GUILD_ID,
          name: rawName,
          channelId: parsed.channelId,
          roleId: parsed.roleId,
          pingRoleId: parsed.pingRoleId,
          playCooldownSeconds: parsed.playCooldownSeconds,
          autoArchiveDays: parsed.autoArchiveDays,
        })
        .returning()
      const row = inserted[0]

      await writeAudit({
        bot: 'squishy',
        action: 'game.added',
        actor: access.actor,
        viewing: access.viewing,
        targetType: 'games',
        targetId: row.id,
        before: null,
        after: row,
        success: true,
      }).catch((err) => {
        console.warn('[games POST] audit write failed', err)
      })

      // Fire-and-forget cache refresh. Do NOT await — the response can
      // return before the bot acks; the user-visible write succeeded.
      void refreshBotCache('games POST')

      return NextResponse.json({ ok: true, id: row.id, row }, { status: 201 })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown'
      console.error('[games POST] db write failed', err)
      await writeAudit({
        bot: 'squishy',
        action: 'game.added',
        actor: access.actor,
        viewing: access.viewing,
        targetType: 'games',
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

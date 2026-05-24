/**
 * POST /api/squishy/games/provision — atomic create-channel + view-role +
 * ping-role + games-row insert via the bot's `game.provision` RPC verb.
 *
 * Body: `{ name: string, parentCategoryId?: snowflake, position?: number,
 *         playCooldownSeconds?: number, autoArchiveDays?: number }`.
 *
 * Driven by the "Auto-provision channel + view role + ping role in #games
 * category" checkbox on the Add Game form (`GamesWriteUI.tsx`). When the
 * sudo submits the form with that box checked, the panel posts here
 * instead of to `/api/squishy/games`; the bot handles the all-or-nothing
 * Discord-resource creation + the catalog INSERT in one go. We do NOT
 * re-call `games.refresh_cache` from here — the bot-side handler already
 * runs `loadGames()` after the insert.
 *
 * Gating: sudo via `withAuth({require:'sudo'})`, CSRF on, 10/min — same
 * shape as the per-resource create-role/create-channel routes since the
 * bot work and audit churn is similar.
 *
 * Audit action: `game.provisioned`. We log both the submitted shape and
 * the returned IDs so an operator can grep for "who provisioned this game"
 * without having to cross-reference three audit rows.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { withAuth } from '@/lib/auth/middleware'
import { writeAudit } from '@/lib/audit'
import { callBot } from '@/lib/botrpc'
import { checkGamesWriteGuildLimits } from '@/lib/limits/gamesProvision'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SNOWFLAKE_RE = /^\d{15,25}$/
const MAX_NAME_LEN = 100
const MAX_COOLDOWN_SEC = 365 * 24 * 60 * 60

type Body = {
  name?: unknown
  parentCategoryId?: unknown
  position?: unknown
  playCooldownSeconds?: unknown
  autoArchiveDays?: unknown
}

function parseOptionalSnowflake(raw: unknown): { ok: true; value: string | undefined } | { ok: false } {
  if (raw === undefined || raw === null || raw === '') return { ok: true, value: undefined }
  if (typeof raw !== 'string') return { ok: false }
  const t = raw.trim()
  if (t === '') return { ok: true, value: undefined }
  if (!SNOWFLAKE_RE.test(t)) return { ok: false }
  return { ok: true, value: t }
}

function parseOptionalInt(
  raw: unknown,
  max: number,
): { ok: true; value: number | undefined } | { ok: false } {
  if (raw === undefined || raw === null || raw === '') return { ok: true, value: undefined }
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > max) return { ok: false }
  return { ok: true, value: n }
}

export const POST = withAuth(
  async (req: NextRequest, access) => {
    let body: Body
    try {
      body = ((await req.json()) ?? {}) as Body
    } catch {
      return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
    }

    const rawName = typeof body.name === 'string' ? body.name.trim() : ''
    if (rawName.length === 0 || rawName.length > MAX_NAME_LEN) {
      return NextResponse.json(
        { error: `name must be 1-${MAX_NAME_LEN} chars` },
        { status: 400 },
      )
    }

    const parentParse = parseOptionalSnowflake(body.parentCategoryId)
    if (!parentParse.ok) {
      return NextResponse.json(
        { error: 'parentCategoryId must be a Discord snowflake (15-25 digits)' },
        { status: 400 },
      )
    }

    const posParse = parseOptionalInt(body.position, 1000)
    if (!posParse.ok) {
      return NextResponse.json({ error: 'position must be an integer 0..1000' }, { status: 400 })
    }

    const cooldownParse = parseOptionalInt(body.playCooldownSeconds, MAX_COOLDOWN_SEC)
    if (!cooldownParse.ok) {
      return NextResponse.json(
        { error: `playCooldownSeconds must be a non-negative integer ≤ ${MAX_COOLDOWN_SEC}` },
        { status: 400 },
      )
    }

    const archiveParse = parseOptionalInt(body.autoArchiveDays, 3650)
    if (!archiveParse.ok) {
      return NextResponse.json(
        { error: 'autoArchiveDays must be a non-negative integer ≤ 3650' },
        { status: 400 },
      )
    }

    // Per-guild ceiling shared with create-role / create-channel. Defends
    // Discord's per-guild 250-role / 500-channel caps against a runaway
    // sudo session or compromised actor combining multiple routes. See
    // #226 + lib/limits/gamesProvision.ts.
    const guildLimit = checkGamesWriteGuildLimits()
    if (!guildLimit.ok) {
      return NextResponse.json(
        { error: guildLimit.error, retryAfter: guildLimit.retryAfterSec },
        { status: 429, headers: { 'Retry-After': String(guildLimit.retryAfterSec) } },
      )
    }

    const submitted = {
      name: rawName,
      parentCategoryId: parentParse.value,
      position: posParse.value,
      playCooldownSeconds: cooldownParse.value,
      autoArchiveDays: archiveParse.value,
    }

    const reply = await callBot('squishy', 'game.provision', submitted)

    if (!reply.ok) {
      await writeAudit({
        bot: 'squishy',
        action: 'game.provisioned',
        actor: access.actor,
        viewing: access.viewing,
        targetType: 'games',
        before: null,
        after: submitted,
        success: false,
        errorMessage: reply.error,
      }).catch(() => {})

      // Friendly status mapping: `game-exists` is a client-side conflict;
      // missing-permissions is 403; transport problems are 503; everything
      // else is a 400. The error token is what the panel renders, so the
      // exact mapping mostly matters for fetch-side error display.
      const status =
        reply.error === 'timeout' || reply.error === 'rpc-not-configured' ? 503
          : reply.error === 'missing-permissions' ? 403
          : reply.error === 'game-exists' ? 409
          : 400
      return NextResponse.json({ error: reply.error, details: reply.details }, { status })
    }

    const data = (reply.data ?? {}) as {
      gameId?: string
      channelId?: string
      viewRoleId?: string
      pingRoleId?: string
    }

    // Allow-list the bot-returned fields stored in the audit row — never
    // trust the bot reply to control what lands in long-retained logs.
    // See #228.
    const auditIds = {
      gameId: typeof data.gameId === 'string' ? data.gameId : null,
      channelId: typeof data.channelId === 'string' ? data.channelId : null,
      viewRoleId: typeof data.viewRoleId === 'string' ? data.viewRoleId : null,
      pingRoleId: typeof data.pingRoleId === 'string' ? data.pingRoleId : null,
    }

    await writeAudit({
      bot: 'squishy',
      action: 'game.provisioned',
      actor: access.actor,
      viewing: access.viewing,
      targetType: 'games',
      targetId: data.gameId ?? null,
      before: null,
      after: { ...submitted, ...auditIds },
      success: true,
    }).catch(() => {})

    return NextResponse.json({ ok: true, data }, { status: 201 })
  },
  {
    require: 'sudo',
    csrf: true,
    // Tightened from 10/min — `provision` does 1 channel + 2 roles + 1 DB
    // insert per call, so the budget should match the work it represents.
    // Per-guild ceilings layered on top (see checkGamesWriteGuildLimits)
    // defend against multiple sudo sessions combining to exhaust Discord's
    // per-guild role/channel caps. See #226.
    rateLimit: { points: 3, perSeconds: 60 },
  },
)

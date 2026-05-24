/**
 * POST /api/squishy/discord/create-role — create a Discord role on the
 * configured guild via the bot's `discord.create_role` RPC verb.
 *
 * Body: `{ name: string, color?: number, hoist?: boolean, mentionable?: boolean }`.
 *
 * Driven by the panel's "+ Create" inline button next to an unset view /
 * ping role link in the games editor (`GamesWriteUI.tsx`). The panel
 * `prompt()`s for the role name, calls this route, then PATCHes the games
 * row to wire the returned role ID into `roleId` or `pingRoleId`.
 *
 * Gating: sudo via `withAuth({require:'sudo'})`. CSRF + 10/min rate limit
 * (the bot writes a Discord role on every call, and audit churn from a
 * stuck panel tab is what the limit is for).
 *
 * Audit action: `discord.role_created`. We log `actor`, `viewing`, the
 * submitted name, and the bot reply payload — there's no panel-side DB row
 * for "role" so the audit is the only paper trail.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { withAuth } from '@/lib/auth/middleware'
import { writeAudit } from '@/lib/audit'
import { callBot } from '@/lib/botrpc'
import { checkGamesWriteGuildLimits } from '@/lib/limits/gamesProvision'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_NAME_LEN = 100
const MAX_COLOR = 0xFFFFFF

type Body = {
  name?: unknown
  color?: unknown
  hoist?: unknown
  mentionable?: unknown
}

function parseColor(raw: unknown): { ok: true; value: number | undefined } | { ok: false } {
  if (raw === undefined || raw === null || raw === '') return { ok: true, value: undefined }
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > MAX_COLOR) {
    return { ok: false }
  }
  return { ok: true, value: n }
}

function parseBool(raw: unknown): boolean | undefined {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw === 'boolean') return raw
  if (raw === 'true') return true
  if (raw === 'false') return false
  return undefined
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

    const colorParse = parseColor(body.color)
    if (!colorParse.ok) {
      return NextResponse.json(
        { error: `color must be an integer 0..${MAX_COLOR}` },
        { status: 400 },
      )
    }

    const hoist = parseBool(body.hoist)
    const mentionable = parseBool(body.mentionable)

    // Per-guild ceiling shared with create-channel / games-provision. See
    // #226 + lib/limits/gamesProvision.ts.
    const guildLimit = checkGamesWriteGuildLimits()
    if (!guildLimit.ok) {
      return NextResponse.json(
        { error: guildLimit.error, retryAfter: guildLimit.retryAfterSec },
        { status: 429, headers: { 'Retry-After': String(guildLimit.retryAfterSec) } },
      )
    }

    const reply = await callBot('squishy', 'discord.create_role', {
      name: rawName,
      color: colorParse.value,
      hoist,
      mentionable,
    })

    if (!reply.ok) {
      await writeAudit({
        bot: 'squishy',
        action: 'discord.role_created',
        actor: access.actor,
        viewing: access.viewing,
        targetType: 'discord_role',
        before: null,
        after: { name: rawName, hoist, mentionable, color: colorParse.value },
        success: false,
        errorMessage: reply.error,
      }).catch(() => {})
      const status = reply.error === 'timeout' || reply.error === 'rpc-not-configured'
        ? 503
        : reply.error === 'missing-permissions' ? 403 : 400
      return NextResponse.json({ error: reply.error, details: reply.details }, { status })
    }

    const data = (reply.data ?? {}) as {
      id?: string
      name?: string
      color?: number
      hoist?: boolean
      mentionable?: boolean
      position?: number
    }

    await writeAudit({
      bot: 'squishy',
      action: 'discord.role_created',
      actor: access.actor,
      viewing: access.viewing,
      targetType: 'discord_role',
      targetId: data.id ?? null,
      before: null,
      after: data,
      success: true,
    }).catch(() => {})

    return NextResponse.json({ ok: true, data }, { status: 201 })
  },
  {
    require: 'sudo',
    csrf: true,
    rateLimit: { points: 10, perSeconds: 60 },
  },
)

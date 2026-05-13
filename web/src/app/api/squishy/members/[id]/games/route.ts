/**
 * POST /api/squishy/members/[id]/games — sudo-edit a target member's game
 * prefs. Mirrors the `/api/squishy/me/games` self-service body shape but
 * the target user is pinned by the URL param rather than the session.
 *
 * Body shape:
 *   `{ prefs: [{ gameId: uuid, view: bool, ping: bool }] }`
 * `<ServerForm>` posts the prefs array as a JSON-encoded string in a
 * single `prefs` field (see `MemberGamePrefsEditor.tsx`); we accept both
 * the stringified and the array-shape so future direct callers don't
 * have to choose.
 *
 * Gating: sudo OR bot-owner. The View-As capability map's `viewing.id`
 * is set to the URL target so the bot's `games.set_prefs` writes the
 * roles for the right user — but the audit `actor` always carries the
 * real signed-in operator so a sudo impersonation trail is preserved.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { withAuth } from '@/lib/auth/middleware'
import { callBot } from '@/lib/botrpc'
import { writeAudit } from '@/lib/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SNOWFLAKE_RE = /^\d{15,25}$/

type PrefRow = { gameId: string; view: boolean; ping: boolean }

function parsePrefs(raw: unknown): { prefs: PrefRow[] } | { error: string } {
  if (Array.isArray(raw)) return validate(raw)
  if (typeof raw === 'string') {
    try {
      return validate(JSON.parse(raw))
    } catch {
      return { error: 'invalid-json' }
    }
  }
  return { error: 'expected-array' }
}

function validate(arr: unknown): { prefs: PrefRow[] } | { error: string } {
  if (!Array.isArray(arr)) return { error: 'expected-array' }
  const out: PrefRow[] = []
  for (const row of arr) {
    if (!row || typeof row !== 'object') return { error: 'row-not-object' }
    const r = row as Record<string, unknown>
    if (typeof r.gameId !== 'string' || !UUID_RE.test(r.gameId)) {
      return { error: 'invalid-gameId' }
    }
    if (typeof r.view !== 'boolean' || typeof r.ping !== 'boolean') {
      return { error: 'invalid-row-flags' }
    }
    out.push({ gameId: r.gameId, view: r.view, ping: r.ping })
  }
  return { prefs: out }
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
    const raw = body && typeof body === 'object' ? (body as { prefs?: unknown }).prefs : undefined
    const parsed = parsePrefs(raw)
    if ('error' in parsed) {
      await writeAudit({
        bot: 'squishy',
        actor: access.actor,
        viewing: { id: targetUserId, username: access.viewing.username },
        action: 'member.games_set',
        targetType: 'user_game_prefs',
        targetId: targetUserId,
        before: null,
        after: null,
        success: false,
        errorMessage: parsed.error,
      }).catch(() => {})
      return NextResponse.json({ error: parsed.error }, { status: 400 })
    }

    const reply = await callBot<{
      applied: number
      skipped: number
      errors: Array<{ gameId: string; reason: string }>
    }>('squishy', 'games.set_prefs', {
      userId: targetUserId,
      prefs: parsed.prefs,
    })

    if (!reply.ok) {
      await writeAudit({
        bot: 'squishy',
        actor: access.actor,
        viewing: { id: targetUserId, username: access.viewing.username },
        action: 'member.games_set',
        targetType: 'user_game_prefs',
        targetId: targetUserId,
        before: null,
        after: { prefs: parsed.prefs },
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
      action: 'member.games_set',
      targetType: 'user_game_prefs',
      targetId: targetUserId,
      before: null,
      after: {
        prefs: parsed.prefs,
        applied: reply.data.applied,
        skipped: reply.data.skipped,
      },
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

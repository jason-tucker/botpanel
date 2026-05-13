/**
 * POST /api/squishy/me/games — self-service batched save for `/me/games`.
 *
 * Any authenticated user can save their own prefs. The route always passes
 * `access.actor.id` to the bot — View-As is intentionally ignored so a sudo
 * impersonating someone else can't write their game prefs through this
 * surface (sudo edits route through `/squishy/games` instead, which
 * targets a different bot verb).
 *
 * Body shape:
 *   `{ prefs: [{ gameId: uuid, view: bool, ping: bool }] }`
 * `<ServerForm>` posts the prefs array as a JSON-encoded string (one
 * single `prefs` field) so the form is one round-trip; we parse it back
 * here before validating.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { withAuth } from '@/lib/auth/middleware'
import { callBot } from '@/lib/botrpc'
import { writeAudit } from '@/lib/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type PrefRow = { gameId: string; view: boolean; ping: boolean }

function parsePrefs(raw: unknown): { prefs: PrefRow[] } | { error: string } {
  // ServerForm sends a JSON string in a single "prefs" field. Accept both
  // the parsed-array shape (legitimate JSON body) and the wrapped-string
  // shape so future callers using a plain fetch don't have to know which
  // path was used.
  if (Array.isArray(raw)) {
    return validate(raw)
  }
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
  async (req: NextRequest, access) => {
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
        viewing: access.viewing,
        action: 'games.prefs_set',
        targetType: 'user_game_prefs',
        targetId: access.actor.id,
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
      userId: access.actor.id,
      prefs: parsed.prefs,
    })

    if (!reply.ok) {
      await writeAudit({
        bot: 'squishy',
        actor: access.actor,
        viewing: access.viewing,
        action: 'games.prefs_set',
        targetType: 'user_game_prefs',
        targetId: access.actor.id,
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
      viewing: access.viewing,
      action: 'games.prefs_set',
      targetType: 'user_game_prefs',
      targetId: access.actor.id,
      before: null,
      after: { prefs: parsed.prefs, applied: reply.data.applied, skipped: reply.data.skipped },
      success: true,
    }).catch(() => {})

    return NextResponse.json({ ok: true, data: reply.data })
  },
  {
    require: 'any',
    csrf: true,
    rateLimit: { points: 10, perSeconds: 60 },
  },
)

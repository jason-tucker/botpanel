/**
 * GET /api/squishy/users/[id] — single-snowflake resolver for the panel.
 *
 * The bulk `users.resolve` path is fine for server-rendered pages
 * (`resolveUsernames` does one round-trip per page render). This endpoint
 * exists for client-driven progressive enhancement on live surfaces — e.g.
 * `VoiceLive` receives an SSE `member_join` event referencing an id the
 * page never had on first render. A tiny client effect can hit this route
 * for just that id and patch the row in place.
 *
 * 5-minute in-process cache shared with `resolveUsernames` (same module-
 * level Map) so a flood of refreshes for the same id doesn't pelt the
 * bot. Failure to reach the bot returns `{id, username:null, ...}` with
 * a 200 — the client falls back to the raw id, same as the batched path.
 *
 * Auth: `withAuth({ require: 'any' })` — anyone logged in. The bot's verb
 * is itself a pure cache read with no privileged data, and exposing the
 * raw snowflake → display name mapping isn't more sensitive than showing
 * the same data inline on the audit page that motivates this work.
 */
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/middleware'
import { resolveOneUsername } from '@/lib/userDisplay'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SNOWFLAKE_RE = /^\d{17,20}$/

export const GET = withAuth(
  async (req) => {
    const id = req.nextUrl.pathname.split('/').filter(Boolean).pop() ?? ''
    if (!SNOWFLAKE_RE.test(id)) {
      return NextResponse.json({ error: 'bad-id' }, { status: 400 })
    }
    const resolved = await resolveOneUsername('squishy', id)
    return NextResponse.json({
      id,
      username: resolved?.username ?? null,
      displayName: resolved?.displayName ?? null,
      avatarUrl: resolved?.avatarUrl ?? null,
    })
  },
  { require: 'any' },
)

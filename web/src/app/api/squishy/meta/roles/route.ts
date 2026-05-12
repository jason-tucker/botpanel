/**
 * GET /api/squishy/meta/roles — proxy to the bot's `meta.list_roles` RPC.
 *
 * Powers the `<RolePicker>` client component. Result is cached server-side
 * for 60 seconds in a module-scoped Map keyed on a fixed constant — roles
 * change rarely (one new role here, one rename there), so a one-minute
 * stale window is well worth eliminating the per-keystroke RPC traffic
 * that a five-control settings page can otherwise generate.
 *
 * Auth: `require: 'any'` — every logged-in user can see role names. The
 * actual settings writes downstream (Hubs / Games / Roles / Welcome
 * editors) still enforce sudo on their own routes, so listing the choices
 * isn't a privilege escalation.
 *
 * Resilience: every error path returns 200 with an `error` token plus an
 * empty `roles` array. The picker falls back to a snowflake-text input
 * when it sees the error, so the form still works when the bot is down.
 */
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/middleware'
import { callBot } from '@/lib/botrpc'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RoleRow = {
  id: string
  name: string
  color: number
  position: number
  managed: boolean
  hoisted: boolean
  mentionable: boolean
}

type Cached = { ts: number; payload: { roles: RoleRow[] } }
const CACHE_TTL_MS = 60_000
// One bucket — the bot serves a single guild, so there's nothing to key on.
const CACHE_KEY = 'roles'
const cache = new Map<string, Cached>()

export const GET = withAuth(
  async () => {
    const hit = cache.get(CACHE_KEY)
    if (hit && Date.now() - hit.ts < CACHE_TTL_MS) {
      return NextResponse.json({ roles: hit.payload.roles, cached: true })
    }

    const reply = await callBot<{ roles: RoleRow[] }>('squishy', 'meta.list_roles', {})
    if (!reply.ok) {
      // 200 + error token: the picker fails open to a snowflake input.
      return NextResponse.json({ roles: [], error: reply.error })
    }

    const payload = { roles: Array.isArray(reply.data?.roles) ? reply.data.roles : [] }
    cache.set(CACHE_KEY, { ts: Date.now(), payload })
    return NextResponse.json({ roles: payload.roles, cached: false })
  },
  { require: 'any' },
)

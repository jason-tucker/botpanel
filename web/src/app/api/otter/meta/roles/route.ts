/**
 * GET /api/otter/meta/roles — proxy to otterbot's `meta.list_roles` RPC.
 *
 * Mirror of `/api/squishy/meta/roles`. Powers the role allowlist picker on
 * `/otter/oc-stock` (and any future /otter surface that names Discord roles
 * directly). Same 60 s server-side cache and same degrade-don't-break
 * posture: a bot-side failure returns `{ roles: [], error }` with a 200 so
 * the client can fall back to a plain snowflake input.
 *
 * `require: 'any'` — role names + ids are already visible to every guild
 * member in Discord, and the routes that actually act on a role id do
 * their own capability check.
 */
import { NextResponse, type NextRequest } from 'next/server'
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
const CACHE_KEY = 'roles'
const cache = new Map<string, Cached>()

export const GET = withAuth(
  async (_req: NextRequest) => {
    const hit = cache.get(CACHE_KEY)
    if (hit && Date.now() - hit.ts < CACHE_TTL_MS) {
      return NextResponse.json({ roles: hit.payload.roles, cached: true })
    }

    const reply = await callBot<{ roles: RoleRow[] }>('otter', 'meta.list_roles', {})
    if (!reply.ok) {
      return NextResponse.json({ roles: [], error: reply.error })
    }

    const payload = { roles: Array.isArray(reply.data?.roles) ? reply.data.roles : [] }
    cache.set(CACHE_KEY, { ts: Date.now(), payload })
    return NextResponse.json({ roles: payload.roles, cached: false })
  },
  { require: 'any' },
)

/**
 * GET /api/otter/businesses/[slug]/roster
 *
 * Proxies the bot's `business.roster` RPC verb so the per-business
 * EmployeePanel can render every member with one of this business's
 * mapped Discord roles (owner / manager / employee) instead of only
 * DB-tracked owners.
 *
 * Auth: `require: 'any'` — anyone logged in. The viewing page itself is
 * already gated on `access.otter.businesses[slug]` being non-null (or
 * bot owner), so by the time a user can see the panel they're allowed
 * to read the roster. The per-row write actions still hit the four
 * existing employee routes and re-check `canManage` / `canActAsOwner`
 * there, so this endpoint being broad doesn't widen the write surface.
 *
 * Cache: 30-second module-scoped Map keyed on slug. Mirrors the
 * Wave 7d-A meta-picker pattern — a panel render with multiple action
 * forms doesn't pelt the bot when the same operator opens the page,
 * issues an action, and the post-action `router.refresh()` re-mounts.
 * Adding `?t=...` (any non-empty query) bypasses the cache so an
 * action's onSuccess can force a fresh read.
 *
 * MKE rejection: the bot itself returns `mke-not-supported` for the
 * `mckenzie` slug, but we also short-circuit with 404 here so the
 * panel doesn't even attempt the round-trip — the `/otter/mke`
 * link-out cards are the canonical surface for MKE staff.
 *
 * Resilience: bot RPC failures return 503 + an `error` token; the
 * panel renders a friendly "roster unavailable" hint instead of
 * crashing the page.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { withAuth } from '@/lib/auth/middleware'
import { callBot } from '@/lib/botrpc'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RosterMember = {
  userId: string
  username: string
  displayName: string
  avatarUrl: string | null
  rank: 'owner' | 'manager' | 'employee'
}

type RosterReply = {
  members: RosterMember[]
  counts: { owner: number; manager: number; employee: number }
}

type Cached = { ts: number; payload: RosterReply }

const CACHE_TTL_MS = 30_000
const cache = new Map<string, Cached>()

// MKE is managed off-panel. Catch both the seeded `mckenzie` slug and the
// legacy `mke` alias the /otter/mke page uses as a constant, so both
// paths return the same friendly 404 even if route plumbing drifts.
const MKE_SLUGS = new Set(['mckenzie', 'mke'])

type RouteCtx = { params: Promise<{ slug: string }> }

export const GET = withAuth<[RouteCtx]>(
  async (req: NextRequest, _access, ctx) => {
    const { slug } = await ctx.params

    if (MKE_SLUGS.has(slug)) {
      return NextResponse.json(
        { error: 'mke-not-supported' },
        { status: 404 },
      )
    }

    // Bypass cache if the caller passed any query param (the panel uses
    // `?t=${Date.now()}` after a write so the next render sees the
    // post-mutation state). Any non-empty search string counts —
    // simpler than parsing a specific key.
    const bypass = req.nextUrl.search.length > 0
    if (!bypass) {
      const hit = cache.get(slug)
      if (hit && Date.now() - hit.ts < CACHE_TTL_MS) {
        return NextResponse.json({ ...hit.payload, cached: true })
      }
    }

    const reply = await callBot<RosterReply>('otter', 'business.roster', {
      businessSlug: slug,
    })

    if (!reply.ok) {
      // Bot-side hard failures (timeout, business-not-found, etc.). Don't
      // poison the cache; let the next render retry.
      const status =
        reply.error === 'timeout' || reply.error === 'rpc-not-configured'
          ? 503
          : reply.error === 'mke-not-supported' || reply.error === 'business-not-found'
            ? 404
            : 400
      return NextResponse.json(
        { error: reply.error, details: reply.details },
        { status },
      )
    }

    const payload: RosterReply = {
      members: Array.isArray(reply.data?.members) ? reply.data.members : [],
      counts: reply.data?.counts ?? { owner: 0, manager: 0, employee: 0 },
    }
    cache.set(slug, { ts: Date.now(), payload })
    return NextResponse.json({ ...payload, cached: false })
  },
  { require: 'any' },
)

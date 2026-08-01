/**
 * GET /api/squishy/meta/members — proxy to the bot's `meta.list_members` RPC.
 *
 * Powers the `<MemberPicker>` typeahead and the command palette's member
 * search. A tiny per-(q,limit) in-process cache (10s TTL) absorbs the
 * keystroke back-and-forth of a typeahead ("jas" → "jaso" → backspace)
 * without a Redis round-trip each time; 10s is short enough that a
 * brand-new join still autocompletes almost immediately. The RPC wait is
 * capped at 2s — typeahead results that arrive later than that are worse
 * than an error hint.
 *
 * Query:
 *   `?q=<text>`   — case-insensitive `includes` over username + displayName.
 *   `?limit=N`    — clamped to 1..100 by the bot side; default 25.
 *
 * Auth + resilience match the other meta routes — `require: 'any'`, errors
 * surface as 200 + `{ members: [], error }` so the picker can render a
 * "couldn't reach bot" hint instead of throwing.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { withAuth } from '@/lib/auth/middleware'
import { callBot } from '@/lib/botrpc'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type MemberRow = {
  id: string
  username: string
  displayName: string
  avatarUrl: string
}

const CACHE_TTL_MS = 10_000
const CACHE_MAX_KEYS = 500
const searchCache = new Map<string, { members: MemberRow[]; expiresAt: number }>()

export const GET = withAuth(
  async (req: NextRequest) => {
    const q = (req.nextUrl.searchParams.get('q') ?? '').slice(0, 100)
    const limitRaw = req.nextUrl.searchParams.get('limit')
    let limit = 25
    if (limitRaw) {
      const n = Number(limitRaw)
      if (Number.isFinite(n)) limit = Math.max(1, Math.min(100, Math.floor(n)))
    }

    const key = `${limit}|${q.toLowerCase()}`
    const cached = searchCache.get(key)
    if (cached && cached.expiresAt > Date.now()) {
      return NextResponse.json({ members: cached.members })
    }

    const reply = await callBot<{ members: MemberRow[] }>(
      'squishy',
      'meta.list_members',
      { query: q, limit },
      { timeoutMs: 2000 },
    )
    if (!reply.ok) {
      return NextResponse.json({ members: [], error: reply.error })
    }
    const members = Array.isArray(reply.data?.members) ? reply.data.members : []
    if (searchCache.size >= CACHE_MAX_KEYS) searchCache.clear()
    searchCache.set(key, { members, expiresAt: Date.now() + CACHE_TTL_MS })
    return NextResponse.json({ members })
  },
  { require: 'any' },
)

/**
 * GET /api/squishy/meta/members — proxy to the bot's `meta.list_members` RPC.
 *
 * Powers the `<MemberPicker>` typeahead combobox. No server-side cache —
 * the picker fires on every keystroke (debounced 200ms client-side) and a
 * staleness window would mean a brand-new join doesn't autocomplete. The
 * bot side is a cache read with no Discord API hop, so unbounded query
 * fanout is fine — the bot's in-memory member iteration is sub-ms.
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

export const GET = withAuth(
  async (req: NextRequest) => {
    const q = (req.nextUrl.searchParams.get('q') ?? '').slice(0, 100)
    const limitRaw = req.nextUrl.searchParams.get('limit')
    let limit = 25
    if (limitRaw) {
      const n = Number(limitRaw)
      if (Number.isFinite(n)) limit = Math.max(1, Math.min(100, Math.floor(n)))
    }

    const reply = await callBot<{ members: MemberRow[] }>(
      'squishy',
      'meta.list_members',
      { query: q, limit },
    )
    if (!reply.ok) {
      return NextResponse.json({ members: [], error: reply.error })
    }
    const members = Array.isArray(reply.data?.members) ? reply.data.members : []
    return NextResponse.json({ members })
  },
  { require: 'any' },
)

/**
 * GET /api/otter/meta/members — proxy to OtterBot's `meta.list_members` RPC.
 *
 * Mirror of `/api/squishy/meta/members` (Wave 7d-A) — same query shape,
 * same fallback posture, just targets the otter command bus. Powers
 * `<MemberPicker bot="otter" />` on the otter dashboard (EmployeePanel
 * hire / manage-by-id, BusinessAdminControls add-owner).
 *
 * Query:
 *   `?q=<text>`   — case-insensitive `includes` over username + displayName.
 *   `?limit=N`    — clamped to 1..100 by the bot side; default 25.
 *
 * Auth `require: 'any'`. Errors surface as 200 + `{ members: [], error }`
 * so the picker renders the snowflake fallback instead of throwing.
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
      'otter',
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

/**
 * GET /api/otter/users/[id] — single-snowflake resolver for otter pages.
 *
 * Mirror of `/api/squishy/users/[id]` for otter audit + employee surfaces.
 * Same in-process cache, same `'any'` gate, same null-fallback shape.
 *
 * See the squishy variant's header comment for the full rationale; the
 * one-difference is `bot: 'otter'` so the verb hits otterbot's
 * multi-guild member-cache scan.
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
    const resolved = await resolveOneUsername('otter', id)
    return NextResponse.json({
      id,
      username: resolved?.username ?? null,
      displayName: resolved?.displayName ?? null,
      avatarUrl: resolved?.avatarUrl ?? null,
    })
  },
  { require: 'any' },
)

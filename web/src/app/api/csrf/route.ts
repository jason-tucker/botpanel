/**
 * GET /api/csrf — issue a fresh CSRF token.
 *
 * Sets the `__Host-csrf` cookie (non-HttpOnly so client JS can read
 * it) and returns the same token in the JSON body for clients that
 * prefer to read it once and cache. Every state-changing call from
 * the dashboard must echo this value back in `x-csrf-token` (or as a
 * `_csrf` form field) — see `lib/auth/csrf.ts`.
 *
 * Wrapped in `withAuth({ require: 'any', csrf: false })` because:
 *   - You must be logged in to obtain a token (so unauth attackers
 *     can't farm tokens to use against a victim's session).
 *   - CSRF verification is skipped on THIS endpoint specifically;
 *     there's no prior token to compare against on the very first
 *     request and GET is idempotent anyway.
 */
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/middleware'
import { issueCsrfToken } from '@/lib/auth/csrf'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const GET = withAuth(
  async (_req: NextRequest) => {
    const token = await issueCsrfToken()
    return NextResponse.json(
      { token },
      {
        headers: {
          // Never cache — every fetch should return a fresh-ish token.
          'Cache-Control': 'no-store, no-cache, must-revalidate',
        },
      },
    )
  },
  { require: 'any', csrf: false },
)

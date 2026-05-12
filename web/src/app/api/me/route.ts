import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/middleware'
import type { AccessMap } from '@/lib/auth/perms'

/**
 * GET /api/me — returns the full AccessMap for the logged-in viewer.
 * Future SPA-ish nav rendering reads this once on hydration so the
 * client can hide/show menus without re-rendering. Server pages should
 * still call `resolveAccess()` directly for SSR gating.
 */
export const dynamic = 'force-dynamic'

export const GET = withAuth(async (_req, access: AccessMap) => {
  return NextResponse.json({ ok: true, access })
})

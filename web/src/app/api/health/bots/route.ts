import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/middleware'
import { getShellHealth } from '@/lib/heartbeats'

/**
 * GET /api/health/bots — normalized live bot health for the topbar pills.
 *
 * `getShellHealth()` reads the in-process heartbeat map (fed by the Redis
 * psubscribe), so this is essentially free. Logged-in only (`require: 'any'`);
 * GET so CSRF is bypassed. The shape is `{ bots: { <name>: { online, … } } }`
 * — offline/stale bots are simply absent from the map and the client fills
 * "offline" for any expected name that's missing.
 */
export const dynamic = 'force-dynamic'

export const GET = withAuth(async () => {
  return NextResponse.json({ bots: getShellHealth() })
})

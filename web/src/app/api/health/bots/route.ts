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
 *
 * `resolveCaps: false`: the handler never reads capabilities and this is
 * polled every 30s per open tab — skipping the Postgres/RPC capability
 * resolution keeps the poll free AND keeps the health pills working even
 * while the bot databases are down (which is exactly when you want them).
 */
export const dynamic = 'force-dynamic'

export const GET = withAuth(
  async () => {
    return NextResponse.json({ bots: getShellHealth() })
  },
  { require: 'any', resolveCaps: false },
)

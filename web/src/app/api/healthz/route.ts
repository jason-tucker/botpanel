/**
 * Health check consumed by the landing page (via Caddy at the same origin).
 * Returns 200 when Next.js is up plus a live per-bot heartbeat snapshot
 * aggregated from Redis pub/sub.
 *
 * The `bots` map is populated by `lib/heartbeats.ts`, which psubscribes to
 * `bot.*.bot.heartbeat` once per process. Bots that haven't beat in 3× the
 * 60s publish tick (180s) are omitted entirely so the landing page falls
 * back to "no heartbeat yet" rather than showing a stale uptime.
 */
import { getHeartbeats } from '@/lib/heartbeats'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET() {
  return Response.json({
    ok: true,
    status: 'up',
    ts: new Date().toISOString(),
    bots: getHeartbeats(),
  }, {
    headers: {
      // Landing page polls every 10s — must always see the freshest snapshot.
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  })
}

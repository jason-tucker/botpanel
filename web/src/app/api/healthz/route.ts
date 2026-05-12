/**
 * Health check consumed by the landing page (via Caddy at the same origin).
 * Returns 200 when Next.js is up. In MVP+, the response will also include
 * per-bot Redis-heartbeat state so the landing page's two bot rows go green.
 */
export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET() {
  return Response.json({
    ok: true,
    status: 'up',
    ts: new Date().toISOString(),
    // Bot heartbeats fed by Redis come online with the eventBus.ts work.
    // Until then, the landing page shows "no heartbeat yet" for both rows.
    bots: {},
  }, {
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  })
}

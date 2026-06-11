/**
 * GET /api/push/config — runtime VAPID public key delivery.
 *
 * Web Push needs the VAPID public key client-side to call
 * `pushManager.subscribe({ applicationServerKey })`. We can't use
 * `NEXT_PUBLIC_VAPID_PUBLIC` for this because Next.js inlines
 * `NEXT_PUBLIC_*` at build time — the image baked by CI doesn't have
 * the value, and changing it requires a rebuild + redeploy. By serving
 * the key from a runtime route, the operator can rotate VAPID keys by
 * editing `.env` + restarting the container, no image rebuild needed.
 *
 * Knowing the public key is not sensitive (it's literally the public
 * half of a keypair, sent to every push endpoint), but we still gate
 * behind `withAuth({ require: 'any' })` so anonymous probes can't use
 * it to fingerprint the deployment.
 */
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/middleware'
import { env } from '@/lib/env'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = withAuth(
  async () => {
    const key = env.VAPID_PUBLIC
    if (!key) {
      return NextResponse.json({ error: 'vapid-not-configured' }, { status: 503 })
    }
    return NextResponse.json({ publicKey: key })
  },
  // `resolveCaps: false` — the handler never reads capabilities; "logged
  // in" is the whole gate, so skip the Postgres/RPC capability lookups.
  { require: 'any', resolveCaps: false },
)

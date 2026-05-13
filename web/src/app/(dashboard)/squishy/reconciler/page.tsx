/**
 * /squishy/reconciler — sudo Run-Reconciler page.
 *
 * Mirrors the `/sudo → Run reconciler` slash button. The same logic
 * already lives on `/sudo/debug` as one of three buttons; this page
 * exists so the sidebar's "Squishy · /sudo" group has a dedicated
 * landing that matches the bot's panel 1:1.
 *
 * Behavior:
 *  - Bot-owner gate (the verb itself is owner-only).
 *  - Renders just the "Run reconciler" button + result strip from the
 *    existing `<AdminOpsCard>` component. We can't import the
 *    sub-component directly because it's not exported individually,
 *    so we inline the same wiring here (a thin ServerForm wrapper
 *    over POST `/api/sudo/admin/reconciler`).
 */
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/session'
import { resolveAccess } from '@/lib/auth/perms'
import { ReconcilerCard } from './ReconcilerCard'

export const dynamic = 'force-dynamic'

export default async function ReconcilerPage() {
  const session = await getSession()
  if (!session) redirect('/api/auth/login')
  const access = await resolveAccess(session)

  if (!access.botOwner) {
    return (
      <main className="min-h-dvh p-6 sm:p-10">
        <div className="max-w-md mx-auto rounded-2xl border border-line bg-bg-card p-6 flex flex-col gap-3">
          <h1 className="text-xl font-semibold">Bot-owner only</h1>
          <p className="text-ink-dim text-sm">
            The voice reconciler is the heaviest of the admin ops — it walks
            every <code>auto_channels</code> row and rebuilds Discord state.
            Only the bot owner can trigger it.
          </p>
          <Link href="/me" className="text-sm text-accent underline self-start">
            ← Back to dashboard
          </Link>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-dvh p-6 sm:p-10 pt-16 md:pt-10">
      <div className="max-w-2xl mx-auto flex flex-col gap-6">
        <header>
          <h1 className="text-2xl font-semibold">
            <code className="font-mono">/sudo</code> → Run Reconciler
          </h1>
          <p className="text-sm text-ink-dim mt-1 max-w-2xl">
            Re-run the voice reconciler on demand. This is the same routine
            that runs on bot boot: walks every <code>auto_channels</code> row,
            syncs permissions, rebuilds control panels, and adopts any hubs
            that drifted. Heavy — rate-limited to 5/min/actor.
          </p>
        </header>

        <ReconcilerCard />
      </div>
    </main>
  )
}

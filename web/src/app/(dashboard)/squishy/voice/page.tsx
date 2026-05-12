/**
 * /squishy/voice — Active Voice Channels (live).
 *
 * Server component:
 *  - Verifies a session (middleware already redirects unauth'd to `/`, but
 *    we re-check here so a stale build never accidentally renders an
 *    authed-only shell to a logged-out viewer).
 *  - Resolves the full AccessMap. If the viewer is neither sudo nor
 *    botOwner, render a "no access" card. The API routes are also gated
 *    independently — this just keeps the UI honest.
 *  - Hands off to the client `<VoiceLive />` component which owns the
 *    snapshot fetch + SSE merge loop.
 *
 * Layout note: this page lives under the `(dashboard)` route group, so
 * `<Sidebar>` + the outer `<main>` are owned by the layout — we render a
 * plain `<div>` here and let the sidebar provide nav (no more "← Dashboard"
 * back-link in the header).
 */
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/session'
import { resolveAccess } from '@/lib/auth/perms'
import { VoiceLive } from './VoiceLive'

export const dynamic = 'force-dynamic'

export default async function SquishyVoicePage() {
  const session = await getSession()
  if (!session) redirect('/')

  const access = await resolveAccess(session)
  const allowed = access.squishy.sudo || access.botOwner

  if (!allowed) {
    return (
      <div className="p-6 sm:p-10 pt-16 md:pt-10">
        <div className="max-w-2xl mx-auto flex flex-col gap-6">
          <header>
            <h1 className="text-2xl font-semibold">Active Voice Channels</h1>
          </header>
          <section className="rounded-2xl border border-line bg-bg-card p-6">
            <div className="text-xs uppercase tracking-wider text-ink-dim mb-2">
              No access
            </div>
            <p className="text-ink">
              You don&apos;t have permission to view live voice channels. This
              page is restricted to Squishy sudo users and the bot owner.
            </p>
          </section>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 sm:p-10 pt-16 md:pt-10">
      <div className="max-w-4xl mx-auto flex flex-col gap-6">
        <header>
          <h1 className="text-2xl font-semibold">Active Voice Channels</h1>
        </header>
        <VoiceLive />
      </div>
    </div>
  )
}

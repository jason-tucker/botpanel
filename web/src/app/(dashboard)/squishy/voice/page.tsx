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

  // Everyone in. The snapshot route + SSE both filter per-viewer:
  //   - sudo / bot-owner: see ALL channels
  //   - everyone else: see only channels they're a member of, own, host,
  //     or are acting-owner on (same gate that powers the per-row
  //     `canControl` flag the buttons read).
  // This matches the Discord experience — you see the voice channels
  // you'd see in Discord, no more.
  await resolveAccess(session) // still validate auth resolves cleanly

  return (
    <div className="p-6 sm:p-10 pt-16 md:pt-10">
      <div className="max-w-4xl mx-auto flex flex-col gap-6">
        <header>
          <h1 className="text-2xl font-semibold">Active Voice Channels</h1>
          <p className="text-sm text-ink-dim mt-1">
            Channels you&apos;re in, own, or host. Sudo viewers see everything.
          </p>
        </header>
        <VoiceLive />
      </div>
    </div>
  )
}

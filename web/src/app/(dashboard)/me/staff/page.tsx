/**
 * /me/staff — self-service staff role request.
 *
 * Direct mirror of squishybot's `/settings → Staff Role` button. Sits as
 * a sibling to /me/edit (Profile & Birthday) and /me/games (Game Prefs)
 * so the panel's `/settings` sidebar group matches the slash flow 1:1.
 *
 * Behavior:
 *  - Reuses `<StaffRequestCard>` from the profile editor (single source of
 *    truth — the card itself owns the form, submit handler, and pending-
 *    requests display).
 *  - Loads pending approvals via `loadPendingStaffRequests` so the user
 *    sees their queue before filing another request.
 *  - Sudo / bot-owner viewers see the "Sudo · instant" badge inside the
 *    card; the existing route /api/squishy/staff/request short-circuits
 *    sudo submissions into direct grants (no review queue).
 *  - Signed-in only. Squishy guild membership is a sidebar-level gate;
 *    the page itself doesn't 403 non-guild members because the staff
 *    flow is squishy-specific and the route handler will reject anyway.
 */
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/session'
import { resolveAccess } from '@/lib/auth/perms'
import { env } from '@/lib/env'
import { loadPendingStaffRequests } from '@/lib/staffRequests'
import { StaffRequestCard } from '@/app/(dashboard)/squishy/profiles/[id]/edit/StaffRequestCard'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export default async function MeStaffPage() {
  const session = await getSession()
  if (!session) redirect('/api/auth/login')

  const access = await resolveAccess(session)
  const isSudo = access.squishy.sudo || access.botOwner
  const pending = await loadPendingStaffRequests(env.GUILD_ID, access.actor.id)

  return (
    <main className="min-h-dvh p-6 sm:p-10 pt-16 md:pt-10">
      <div className="max-w-3xl mx-auto flex flex-col gap-6">
        <header>
          <h1 className="text-2xl font-semibold">
            <code className="font-mono">/settings</code> → Staff Role
          </h1>
          <p className="text-sm text-ink-dim mt-1 max-w-2xl">
            Request a staff role for yourself, exactly as the bot&apos;s{' '}
            <code>/settings → Staff Role</code> button does. Pick a department,
            a tier, or both — an admin will review in Discord and you&apos;ll
            get a DM with the outcome. Approving grants the picked roles plus
            the <strong>ITSRI Staff</strong> base role automatically. Sudo
            viewers grant themselves directly with no review queue.
          </p>
        </header>

        <StaffRequestCard pending={pending} isSudo={isSudo} />
      </div>
    </main>
  )
}

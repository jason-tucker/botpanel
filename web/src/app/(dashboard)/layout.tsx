/**
 * Dashboard route-group layout.
 *
 * Every page under `(dashboard)/` shares this shell:
 *   1. Re-verify the session (middleware already redirects unauth'd to `/`,
 *      but we keep this check so a stale build can never render the shell
 *      to a logged-out viewer).
 *   2. Resolve the full `AccessMap` ONCE here so the sidebar can render
 *      capability-gated nav links without each child page paying the
 *      Postgres cost again. Pages still resolve their own access for the
 *      actual authorization gate — this is purely for UI rendering.
 *   3. Hand off to `<DashboardShell>` which owns the visual chrome.
 *
 * Route groups in parens like `(dashboard)` don't appear in the URL, so a
 * file at `(dashboard)/me/page.tsx` still serves `/me`.
 */
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/session'
import { resolveAccess } from '@/lib/auth/perms'
import { env } from '@/lib/env'
import { DashboardShell } from './DashboardShell'

export const dynamic = 'force-dynamic'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession()
  if (!session) redirect('/')

  const access = await resolveAccess(session)

  // Squishy is single-guild — we pass GUILD_ID down to the client-side
  // sidebar so it can compare against `session.guildIds` and hide the
  // Squishy nav for users who aren't in the configured guild. Otter is
  // multi-guild so we don't have a single ID to check; the sidebar uses
  // the otter-business-rank proxy instead (see Sidebar.tsx).
  const squishyGuildId = env.GUILD_ID ?? null

  return (
    <DashboardShell access={access} session={session} squishyGuildId={squishyGuildId}>
      {children}
    </DashboardShell>
  )
}

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
import { getViewAsUserId } from '@/lib/auth/viewAs'
import { resolveOneUsername } from '@/lib/userDisplay'
import { env } from '@/lib/env'
import { resolveOcStockAccess } from '@/lib/otter/ocStockAccess'
import { DashboardShell } from './DashboardShell'

export const dynamic = 'force-dynamic'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession()
  if (!session) redirect('/')

  // View-As: if the cookie is present we resolve access AS the viewed
  // user — capability checks downstream see the viewed user's caps, audit
  // hooks still record the actor (`access.actor`). Cookie reads are
  // free; the gate inside `resolveAccess` decides whether to honor it
  // (sudo / bot-owner only — everyone else silently sees their own caps).
  const viewAsUserId = await getViewAsUserId()
  const access = await resolveAccess(session, viewAsUserId ? { viewAsUserId } : undefined)

  // When View-As is live, fetch the viewed user's display name + avatar
  // from the bot so the banner + sidebar can render a friendly chip
  // instead of a raw snowflake. `resolveAccess` left those fields blank
  // on purpose (it doesn't have Discord identity, only the ID). Best
  // effort — falls through to the raw ID if the RPC isn't available.
  let viewing = access.viewing
  if (access.actor.id !== access.viewing.id) {
    const resolved = await resolveOneUsername('squishy', access.viewing.id)
    if (resolved) {
      viewing = {
        id: access.viewing.id,
        username: resolved.username ?? resolved.displayName ?? access.viewing.id,
        avatar: resolved.avatarUrl ?? null,
      }
    }
  }
  const accessWithViewing = viewing === access.viewing ? access : { ...access, viewing }

  // Squishy is single-guild — we pass GUILD_ID down to the client-side
  // sidebar so it can compare against `session.guildIds` and hide the
  // Squishy nav for users who aren't in the configured guild. Otter is
  // multi-guild so we don't have a single ID to check; the sidebar uses
  // the otter-business-rank proxy instead (see Sidebar.tsx).
  const squishyGuildId = env.GUILD_ID ?? null

  // OC Stock's audience is operator-configurable, so its nav link can't be
  // decided from the AccessMap alone. The rule set is memoized for 30s in
  // `ocStockAccess`, so this costs at most one small query per half-minute
  // per process — and it degrades to the permissive default if Postgres is
  // down, which is the same answer the page itself would give.
  const ocStock = await resolveOcStockAccess(accessWithViewing)
  const navFlags = {
    ocStockVisible: ocStock.canView,
    ocStockRoleGrant: ocStock.grantedByRole,
  }

  return (
    <DashboardShell
      access={accessWithViewing}
      session={session}
      squishyGuildId={squishyGuildId}
      navFlags={navFlags}
    >
      {children}
    </DashboardShell>
  )
}

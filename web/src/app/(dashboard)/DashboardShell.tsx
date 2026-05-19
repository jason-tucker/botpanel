/**
 * DashboardShell — the visual chrome around every authed page.
 *
 * Server component. The layout resolves the session + AccessMap once and
 * hands them down here; this file only knows about layout (sidebar slot +
 * main content slot). Keeping the `getSession`/`resolveAccess` calls in
 * `layout.tsx` means we can wrap unit-test fixtures around this shell
 * without spinning up a session.
 *
 * The `md:pl-48` on `<main>` matches the 192px fixed-width sidebar on
 * desktop (was 240px / `md:pl-60` — narrowed for more main-column width).
 * On mobile the sidebar collapses to a hamburger and the main content
 * takes the full width; each page adds its own `pt-16` (or similar) on
 * mobile to clear the floating hamburger button. Keep this padding in
 * lockstep with the `w-48` on `<aside>` in Sidebar.tsx.
 */
import type { AccessMap } from '@/lib/auth/perms'
import { Sidebar } from './Sidebar'
import { ViewAsBanner } from './ViewAsBanner'

type SessionLike = {
  id: string
  username: string
  avatar?: string | null
  /**
   * Captured at OAuth callback time so the sidebar can hide bot-specific
   * nav for users who aren't in the relevant guild. `undefined` means
   * "pre-existing JWT minted before this field was added" — readers
   * fall back to the prior visibility flags rather than hiding
   * everything.
   */
  guildIds?: string[]
}

export function DashboardShell({
  access,
  session,
  squishyGuildId,
  children,
}: {
  access: AccessMap
  session: SessionLike
  /**
   * `env.GUILD_ID` resolved on the server and passed down so the
   * client-side sidebar can compare against `session.guildIds`. `null`
   * if the env var isn't set — the sidebar treats that as "can't
   * verify" and falls back to the prior capability-flag visibility.
   */
  squishyGuildId: string | null
  children: React.ReactNode
}) {
  // View-As is active when the resolved viewing user differs from the
  // actor. The layout has already swapped `access.viewing` to the
  // bot-resolved display (username + avatar) if the cookie was set —
  // see `(dashboard)/layout.tsx`.
  const viewAsActive = access.actor.id !== access.viewing.id

  return (
    <div className="min-h-dvh bg-bg">
      {viewAsActive && (
        <ViewAsBanner
          viewingUsername={access.viewing.username || access.viewing.id}
          actorUsername={access.actor.username}
        />
      )}
      <Sidebar
        access={access}
        squishyGuildId={squishyGuildId}
        session={{
          id: session.id,
          username: session.username,
          avatar: session.avatar ?? null,
          // Pass through so the sidebar can hide squishy/otter nav for
          // users not in those guilds. May be undefined on legacy
          // sessions — sidebar falls back to capability flags.
          guildIds: session.guildIds,
        }}
      />
      <main className="md:pl-48 min-h-dvh">{children}</main>
    </div>
  )
}

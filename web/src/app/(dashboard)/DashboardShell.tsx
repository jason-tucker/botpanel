/**
 * DashboardShell — the server half of the authed chrome.
 *
 * The layout resolves the session + AccessMap (with View-As applied) once and
 * hands them here. This component does the *server* work — build the nav model
 * from capabilities, snapshot live bot health, and reduce the AccessMap down
 * to the small serializable prop bag the client `<AppFrame>` needs — then hands
 * off all the interactive layout (rail / sidebar / topbar / ⌘K / toasts) to
 * AppFrame. Page content flows through untouched as `{children}`.
 *
 * Keeping the heavy reads (`resolveAccess`) in `layout.tsx` and the pure
 * transforms here means this file stays trivially testable.
 */
import type { AccessMap } from '@/lib/auth/perms'
import { getShellHealth } from '@/lib/heartbeats'
import { buildNav } from './nav'
import type { ShellDisplayUser, ShellViewAs } from './shellTypes'
import { AppFrame } from './AppFrame'

type SessionLike = {
  id: string
  username: string
  avatar?: string | null
  guildIds?: string[]
}

function avatarUrl(id: string, hash: string | null | undefined): string | null {
  if (!hash) return null
  return `https://cdn.discordapp.com/avatars/${id}/${hash}.png?size=128`
}

export function DashboardShell({
  access,
  session,
  squishyGuildId,
  children,
}: {
  access: AccessMap
  session: SessionLike
  squishyGuildId: string | null
  children: React.ReactNode
}) {
  const viewAsActive = access.actor.id !== access.viewing.id

  const nav = buildNav(
    access,
    {
      id: session.id,
      username: session.username,
      avatar: session.avatar ?? null,
      guildIds: session.guildIds,
    },
    squishyGuildId,
  )

  // Under View-As the layout has already swapped `access.viewing` to the
  // bot-resolved display (full CDN avatar URL); otherwise render the actor's
  // own identity from the session (hash → URL).
  const displayUser: ShellDisplayUser = viewAsActive
    ? {
        id: access.viewing.id,
        name: access.viewing.username || access.viewing.id,
        avatarUrl: access.viewing.avatar, // already a full URL when impersonating
        viewAsActive: true,
      }
    : {
        id: session.id,
        name: session.username,
        avatarUrl: avatarUrl(session.id, session.avatar),
        viewAsActive: false,
      }

  const viewAs: ShellViewAs = viewAsActive
    ? {
        viewingName: access.viewing.username || access.viewing.id,
        actorName: access.actor.username,
      }
    : null

  return (
    <AppFrame
      nav={nav}
      displayUser={displayUser}
      viewAs={viewAs}
      botOwner={access.botOwner}
      health={getShellHealth()}
    >
      {children}
    </AppFrame>
  )
}

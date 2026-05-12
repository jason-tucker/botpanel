/**
 * DashboardShell — the visual chrome around every authed page.
 *
 * Server component. The layout resolves the session + AccessMap once and
 * hands them down here; this file only knows about layout (sidebar slot +
 * main content slot). Keeping the `getSession`/`resolveAccess` calls in
 * `layout.tsx` means we can wrap unit-test fixtures around this shell
 * without spinning up a session.
 *
 * The `md:pl-60` on `<main>` matches the 240px fixed-width sidebar on
 * desktop. On mobile the sidebar collapses to a hamburger and the main
 * content takes the full width; each page adds its own `pt-16` (or
 * similar) on mobile to clear the floating hamburger button.
 */
import type { AccessMap } from '@/lib/auth/perms'
import { Sidebar } from './Sidebar'

type SessionLike = {
  id: string
  username: string
  avatar?: string | null
}

export function DashboardShell({
  access,
  session,
  children,
}: {
  access: AccessMap
  session: SessionLike
  children: React.ReactNode
}) {
  return (
    <div className="min-h-dvh bg-bg">
      <Sidebar
        access={access}
        session={{
          id: session.id,
          username: session.username,
          avatar: session.avatar ?? null,
        }}
      />
      <main className="md:pl-60 min-h-dvh">{children}</main>
    </div>
  )
}

'use client'

/**
 * Dashboard sidebar — the shared chrome around every authed page.
 *
 * Client component because we need:
 *   - `usePathname()` to highlight the active link
 *   - `useState` for the mobile drawer toggle
 *
 * Capability gating: the server-rendered layout resolves the AccessMap
 * once and passes it down here. We re-check on the client only for which
 * groups to render — actual authorization always happens server-side in
 * each page's `resolveAccess()` gate. Keeping this rendering pure means a
 * stale client bundle can never grant access; worst case is a link that
 * 403s when clicked.
 *
 * Mobile (<768px): hamburger button top-left, slide-in drawer with a
 * dimmed backdrop. Desktop (≥768px): always-visible 240px fixed sidebar.
 * The drawer state is intentionally NOT persisted — opening a link on
 * mobile auto-closes via the `onClick` handler.
 */
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import type { AccessMap } from '@/lib/auth/perms'

type SessionLike = {
  id: string
  username: string
  avatar?: string | null
}

type NavLink = { href: string; label: string }
type NavGroup = { heading: string; links: NavLink[] }

function avatarUrl(session: SessionLike): string | null {
  if (!session.avatar) return null
  return `https://cdn.discordapp.com/avatars/${session.id}/${session.avatar}.png?size=128`
}

function NavItem({
  href,
  label,
  active,
  onNavigate,
}: {
  href: string
  label: string
  active: boolean
  onNavigate: () => void
}) {
  const base = 'block rounded-lg px-3 py-2 text-sm font-medium transition-colors'
  const activeCls = 'bg-bg-card2 text-ink'
  const idleCls = 'text-ink-dim hover:bg-bg-card2/50 hover:text-ink'
  return (
    <Link href={href} onClick={onNavigate} className={`${base} ${active ? activeCls : idleCls}`}>
      {label}
    </Link>
  )
}

function GroupHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 pt-4 pb-1 text-[10px] uppercase tracking-wider text-ink-dim/70">
      {children}
    </div>
  )
}

export function Sidebar({ access, session }: { access: AccessMap; session: SessionLike }) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  const showSquishy = access.squishy.sudo || access.botOwner
  const showOtter = Object.keys(access.otter.businesses).length > 0 || access.botOwner
  const showSudo = access.squishy.sudo || access.botOwner

  // We render top-level links inline (no heading) and grouped links with a
  // heading — easier to scan than one mega-list.
  const topLinks: NavLink[] = [
    { href: '/', label: 'Home' },
    { href: '/me', label: 'Dashboard' },
  ]
  const squishyGroup: NavGroup = {
    heading: 'Squishy',
    links: [
      { href: '/squishy/settings', label: 'Settings' },
      { href: '/squishy/hubs', label: 'Hubs' },
      { href: '/squishy/games', label: 'Games' },
      { href: '/squishy/profiles', label: 'Profiles' },
      { href: '/squishy/automation', label: 'Automation' },
      { href: '/squishy/roles', label: 'Roles' },
      { href: '/squishy/voice', label: 'Active Voice' },
    ],
  }
  const otterGroup: NavGroup = {
    heading: 'Otter',
    links: [
      { href: '/otter/businesses', label: 'Businesses' },
      { href: '/otter/oc-stock', label: 'OC Stock' },
    ],
  }
  // "Admin Home" (/sudo) is rendered only for the bot owner — the page
  // itself gates on `access.botOwner` and the cross-cutting view is
  // owner-only in MVP. Sudo-without-owner still sees the rest of the
  // group (audit), they just don't see the Admin Home link.
  const sudoGroup: NavGroup = {
    heading: 'Sudo-only',
    links: [
      ...(access.botOwner ? [{ href: '/sudo', label: 'Admin Home' }] : []),
      { href: '/audit', label: 'Audit Log' },
    ],
  }

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/'
    return pathname === href || pathname.startsWith(`${href}/`)
  }

  const close = () => setOpen(false)
  const avatar = avatarUrl(session)

  // The actual rendered sidebar contents — reused by desktop fixed + mobile
  // drawer so we don't drift between the two.
  const Contents = (
    <div className="flex h-full flex-col">
      <div className="px-4 pt-5 pb-4 border-b border-line">
        <div className="text-lg font-semibold text-ink">Botpanel</div>
        <div className="text-xs text-ink-dim mt-0.5">Squishy + Otter admin</div>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-2 flex flex-col gap-0.5">
        {topLinks.map((l) => (
          <NavItem
            key={l.href}
            href={l.href}
            label={l.label}
            active={isActive(l.href)}
            onNavigate={close}
          />
        ))}

        {showSquishy && (
          <>
            <GroupHeading>{squishyGroup.heading}</GroupHeading>
            {squishyGroup.links.map((l) => (
              <NavItem
                key={l.href}
                href={l.href}
                label={l.label}
                active={isActive(l.href)}
                onNavigate={close}
              />
            ))}
          </>
        )}

        {showOtter && (
          <>
            <GroupHeading>{otterGroup.heading}</GroupHeading>
            {otterGroup.links.map((l) => (
              <NavItem
                key={l.href}
                href={l.href}
                label={l.label}
                active={isActive(l.href)}
                onNavigate={close}
              />
            ))}
          </>
        )}

        {showSudo && (
          <>
            <GroupHeading>{sudoGroup.heading}</GroupHeading>
            {sudoGroup.links.map((l) => (
              <NavItem
                key={l.href}
                href={l.href}
                label={l.label}
                active={isActive(l.href)}
                onNavigate={close}
              />
            ))}
          </>
        )}
      </nav>

      <div className="border-t border-line p-3 flex flex-col gap-2">
        <div className="flex items-center gap-3 px-1">
          {avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={avatar}
              alt=""
              className="w-8 h-8 rounded-full border border-line"
            />
          ) : (
            <div className="w-8 h-8 rounded-full bg-bg-card2 border border-line flex items-center justify-center text-xs text-ink-dim">
              {session.username.slice(0, 1).toUpperCase()}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="text-sm text-ink truncate">{session.username}</div>
            {access.botOwner && (
              <div className="text-[10px] uppercase tracking-wider text-ok">Bot owner</div>
            )}
          </div>
        </div>
        <form action="/api/auth/logout" method="POST">
          <button
            type="submit"
            className="w-full rounded-lg border border-line bg-transparent text-ink-dim hover:text-ink hover:bg-bg-card2/50 text-xs font-medium py-1.5"
          >
            Sign out
          </button>
        </form>
      </div>
    </div>
  )

  return (
    <>
      {/* Mobile hamburger — only visible <md. Sits above content but below
          the drawer so the drawer can fully cover it when open. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open navigation"
        className="md:hidden fixed top-3 left-3 z-30 rounded-lg border border-line bg-bg-card text-ink px-3 py-2 text-sm"
      >
        <span aria-hidden>≡</span> Menu
      </button>

      {/* Desktop fixed sidebar. */}
      <aside className="hidden md:flex fixed inset-y-0 left-0 w-60 border-r border-line bg-bg-card z-20">
        {Contents}
      </aside>

      {/* Mobile drawer + backdrop. Rendered always so transitions can run;
          pointer-events / opacity gated by `open`. */}
      <div
        onClick={close}
        aria-hidden={!open}
        className={`md:hidden fixed inset-0 z-40 bg-black/60 transition-opacity ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />
      <aside
        className={`md:hidden fixed inset-y-0 left-0 z-50 w-64 border-r border-line bg-bg-card transition-transform ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {Contents}
      </aside>
    </>
  )
}

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
 * dimmed backdrop. Desktop (≥768px): always-visible 192px fixed sidebar
 * (was 240px — narrowed for more main-column width). The drawer state
 * is intentionally NOT persisted — opening a link on mobile auto-closes
 * via the `onClick` handler.
 */
import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import type { AccessMap } from '@/lib/auth/perms'

type SessionLike = {
  id: string
  username: string
  avatar?: string | null
  /**
   * Discord guild IDs the user is a member of, captured at login. Used
   * here to hide bot-specific nav for users not in the relevant guild.
   * `undefined` means the JWT predates this field — we fall back to the
   * existing capability-derived flags rather than hiding everything,
   * which would lock out anyone with a stale session until they
   * re-login.
   */
  guildIds?: string[]
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

export function Sidebar({
  access,
  session,
  squishyGuildId,
}: {
  access: AccessMap
  session: SessionLike
  /** Squishy's configured guild ID (or null if unset). */
  squishyGuildId: string | null
}) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  // ─── Guild-membership gates ────────────────────────────────────────
  // `session.guildIds` is undefined on JWTs minted before the field was
  // added — we treat undefined as "unknown" and skip the gate, falling
  // back to the prior capability flags. New logins always have the
  // array (possibly empty if Discord's /guilds endpoint was throttled).
  // Bot owner always sees both — useful for support / debug.
  const guildIdsKnown = Array.isArray(session.guildIds)
  const inSquishyGuild =
    guildIdsKnown && squishyGuildId !== null
      ? (session.guildIds ?? []).includes(squishyGuildId)
      : null // unknown
  // Otter is multi-guild — no single ID to compare. Use otter-business
  // membership as a proxy: any non-zero business rank means the user is
  // in at least one otter-managed guild.
  const inOtterGuild = Object.keys(access.otter.businesses).length > 0
  // Final visibility: "in the guild OR bot owner OR unknown-fallback".
  // Falling back to the existing capability flag means a stale session
  // never accidentally hides a sudo's tools.
  // `squishyGuildVisible` is the "is this user in (or transcends) the
  // Squishy guild?" flag, used for BOTH the top-level Squishy links
  // and the Squishy nav group. When the gate is "unknown" (legacy JWT
  // or unconfigured GUILD_ID), we keep the prior behavior so stale
  // sessions don't suddenly lose access.
  const squishyGuildVisible =
    inSquishyGuild === null ? true : inSquishyGuild || access.botOwner
  const otterGuildVisible = inOtterGuild || access.botOwner

  // The nav group itself still requires sudo (it's all sudo-only
  // surfaces) — guild membership is an additional gate so a sudo who
  // somehow isn't in the Squishy guild today doesn't see the group.
  // Bot owner always passes both clauses.
  const showSquishy = (access.squishy.sudo || access.botOwner) && squishyGuildVisible
  const showOtter = (Object.keys(access.otter.businesses).length > 0 || access.botOwner) && otterGuildVisible
  const showMke = access.otter.businesses.mke != null || access.botOwner
  const showSudo = access.squishy.sudo || access.botOwner

  // Nav structure mirrors the Discord slash-command flow. Each group
  // header reads like a slash command (or the menu the bot exposes via
  // that command), and each link in the group is what you'd hit clicking
  // a button inside it. Matches the bot's own information architecture
  // so a user fluent in slash commands finds the panel intuitive.
  //
  // Map:
  //   "Home"               — landing + bug report (`/help`, `/report`).
  //   "/settings"          — self-service (Profile · Game Prefs · Staff).
  //   "Squishy · /sudo"    — sudo admin (Settings, Manage User, Hubs, …).
  //                          Direct mirror of `/sudo`'s select-menu panel.
  //   "Squishy · More"     — surfaces not mapped to a slash button but
  //                          still operational: Welcome/Goodbye, Profiles,
  //                          Games catalog, Automation, Roles, Archives,
  //                          per-bot audit log.
  //   "Otter"              — direct slash command mirrors: /portal, /oc,
  //                          /caked, /lookup-style MKE access.
  //   "Sudo-only"          — cross-bot owner tooling (kept).
  const topLinksAlways: NavLink[] = [
    { href: '/', label: 'Home' },
    { href: '/me', label: 'Dashboard' },
    { href: '/report', label: '/report' },
  ]
  // "/settings" self-service group — mirrors the three buttons on
  // squishybot's `/settings` panel. Only shown when the user is in the
  // Squishy guild (the staff-role flow is squishy-specific).
  const settingsGroup: NavGroup = {
    heading: '/settings',
    links: [
      { href: '/me/edit', label: 'Profile & Birthday' },
      { href: '/me/games', label: 'Game Prefs' },
      // Self-service staff role request lives at /me/staff in PR 2.
      // Until then, the Squishy admin members page covers it via View-As.
    ],
  }
  // Voice control panel — squishy's `/voice` slash gets its own entry
  // (separate from /sudo's Active VCs which lists everything).
  const voiceLink: NavLink = { href: '/squishy/voice', label: '/voice' }
  // "Squishy · /sudo" — mirrors the bot's `/sudo` select-menu panel.
  // Buttons in `/sudo` map to: Settings, Manage user, Game Night,
  // Active VCs, Hubs, Force cleanup, Pending approvals, Run reconciler,
  // Restart instructions. We only render the ones that have a panel
  // surface today; the rest land via PR 2.
  const squishyAdminGroup: NavGroup = {
    heading: 'Squishy · /sudo',
    links: [
      { href: '/squishy/settings', label: 'Settings' },
      { href: '/squishy/members', label: 'Manage User' },
      { href: '/squishy/hubs', label: 'Hubs' },
      // Game Night / Force cleanup / Pending approvals / Run reconciler
      // are PR 2 additions — see CHANGELOG.
    ],
  }
  // "Squishy · More" — surfaces with no direct slash-command equivalent
  // but still useful (Welcome/Goodbye autopost, profile gallery, game
  // catalog editor, automation rules, role manager, archives, per-bot
  // audit log). Kept as a separate group so the sudo flow above stays
  // tightly aligned to the slash panel.
  const squishyMoreGroup: NavGroup = {
    heading: 'Squishy · More',
    links: [
      { href: '/squishy/welcome', label: 'Welcome / Goodbye' },
      { href: '/squishy/profiles', label: 'Profiles' },
      { href: '/squishy/games', label: 'Games (catalog)' },
      { href: '/squishy/automation', label: 'Automation' },
      { href: '/squishy/roles', label: 'Roles' },
      { href: '/squishy/archives', label: 'Archives' },
      { href: '/squishy/audit', label: 'Audit log' },
    ],
  }
  // Otter group — labels match slash command names so users who type
  // them in Discord recognize the panel surface instantly. MKE only
  // appears for users with an MKE rank (staff lookup tooling, not
  // public). Missing slash mirrors (/lookup, /business, /employee,
  // /printinfo, /artsize, /tcsheet, /movechannel) land in PR 2.
  const otterGroup: NavGroup = {
    heading: 'Otter',
    links: [
      { href: '/otter/businesses', label: '/portal' },
      ...(showMke ? [{ href: '/otter/mke', label: '/lookup · MKE' }] : []),
      { href: '/otter/oc-stock', label: '/oc' },
      { href: '/otter/caked', label: '/caked' },
    ],
  }
  // "Admin Home" (/sudo) and "Debug" (/sudo/debug) are rendered only for
  // the bot owner — both pages gate on `access.botOwner` and the cross-
  // cutting + runtime-introspection views are owner-only in MVP. Sudo-
  // without-owner still sees the rest of the group (audit), they just
  // don't see the owner-only links.
  const sudoGroup: NavGroup = {
    heading: 'Sudo-only',
    links: [
      ...(access.botOwner
        ? [
            { href: '/sudo', label: 'Admin Home' },
            { href: '/sudo/debug', label: 'Debug' },
            { href: '/sudo/rpc-test', label: 'RPC Test' },
          ]
        : []),
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
        {/* Top-level: Home + Dashboard + /report. /report always renders
            (the page itself per-bot-gates each form on guild membership). */}
        {topLinksAlways.map((l) => (
          <NavItem
            key={l.href}
            href={l.href}
            label={l.label}
            active={isActive(l.href)}
            onNavigate={close}
          />
        ))}

        {/* "/settings" self-service group — only meaningful for users in
            the Squishy guild (the bot the panel mirrors for self-service
            today). Bot owner sees it regardless. */}
        {squishyGuildVisible && (
          <>
            <GroupHeading>{settingsGroup.heading}</GroupHeading>
            {settingsGroup.links.map((l) => (
              <NavItem
                key={l.href}
                href={l.href}
                label={l.label}
                active={isActive(l.href)}
                onNavigate={close}
              />
            ))}
            {/* `/voice` slash-command equivalent — separate entry so
                it reads as the standalone command, not buried under
                /sudo's Active VCs. Anyone in the guild can hit it
                (the page itself filters to channels they can see). */}
            <NavItem
              href={voiceLink.href}
              label={voiceLink.label}
              active={isActive(voiceLink.href)}
              onNavigate={close}
            />
          </>
        )}

        {/* "Squishy · /sudo" — mirrors the bot's /sudo select-menu. */}
        {showSquishy && (
          <>
            <GroupHeading>{squishyAdminGroup.heading}</GroupHeading>
            {squishyAdminGroup.links.map((l) => (
              <NavItem
                key={l.href}
                href={l.href}
                label={l.label}
                active={isActive(l.href)}
                onNavigate={close}
              />
            ))}
            <GroupHeading>{squishyMoreGroup.heading}</GroupHeading>
            {squishyMoreGroup.links.map((l) => (
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
            // priority — the sidebar renders on every authed page, the user's
            // own avatar is above the fold, no point lazy-loading it.
            <Image
              src={avatar}
              alt=""
              width={32}
              height={32}
              priority
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

      {/* Desktop fixed sidebar. `w-48` (192px) — narrower than the previous
          240px so the main column gets more horizontal real estate. The
          longest label ("Welcome / Goodbye") still fits at 192px without
          wrapping at our chosen text size. The matching `md:pl-48` lives
          in DashboardShell.tsx — keep them in lockstep. */}
      <aside className="hidden md:flex fixed inset-y-0 left-0 w-48 border-r border-line bg-bg-card z-20">
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

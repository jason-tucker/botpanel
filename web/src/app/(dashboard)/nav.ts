/**
 * Central navigation model.
 *
 * The Discord-style shell renders three views of the SAME data: the icon
 * rail (top-level sections), the contextual sidebar (the active section's
 * groups), and the ⌘K command palette (every item, flattened + searchable).
 * Keeping one model means those three never drift.
 *
 * `buildNav` runs on the server (it reads the resolved `AccessMap`) and
 * returns a plain serializable object so it can be handed to the client
 * shell. It faithfully ports the capability + guild-membership gating that
 * used to live inline in the old `Sidebar.tsx`:
 *
 *  - `session.guildIds === undefined` (legacy JWT) → treat as "unknown" and
 *    fall back to capability flags rather than hiding a sudo's tools.
 *  - Squishy nav requires sudo/owner AND Squishy-guild membership.
 *  - Otter nav requires a non-empty business map (or owner).
 *  - MKE link requires an MKE rank (or owner).
 *  - Sudo section requires sudo/owner; owner-only links are gated again.
 */
import type { IconName } from '@/components/ui/icons'
import type { AccessMap } from '@/lib/auth/perms'

export type SectionId = 'overview' | 'squishy' | 'otter' | 'sudo'
export type SectionAccent = 'violet' | 'aqua' | 'gold' | 'rose'

export type NavItem = {
  href: string
  label: string
  icon: IconName
  /** Extra search terms for the command palette. */
  keywords?: string
  /** Render as an external/full navigation (leaves the dashboard shell). */
  external?: boolean
}
export type NavGroup = { heading?: string; items: NavItem[] }
export type NavSection = {
  id: SectionId
  label: string
  icon: IconName
  /** Default route when the rail icon is clicked. */
  href: string
  accent: SectionAccent
  groups: NavGroup[]
}
export type NavModel = { sections: NavSection[] }

type SessionLike = {
  id: string
  username: string
  avatar?: string | null
  guildIds?: string[]
}

export function buildNav(
  access: AccessMap,
  session: SessionLike,
  squishyGuildId: string | null,
): NavModel {
  // ─── Visibility gates (ported verbatim from the old Sidebar) ───────────
  const guildIdsKnown = Array.isArray(session.guildIds)
  const inSquishyGuild =
    guildIdsKnown && squishyGuildId !== null
      ? (session.guildIds ?? []).includes(squishyGuildId)
      : null
  const inOtterGuild = Object.keys(access.otter.businesses).length > 0
  const squishyGuildVisible = inSquishyGuild === null ? true : inSquishyGuild || access.botOwner
  const otterGuildVisible = inOtterGuild || access.botOwner

  const showSquishy = (access.squishy.sudo || access.botOwner) && squishyGuildVisible
  const showOtter = (Object.keys(access.otter.businesses).length > 0 || access.botOwner) && otterGuildVisible
  const showMke = access.otter.businesses.mke != null || access.botOwner
  const showSudo = access.squishy.sudo || access.botOwner

  const sections: NavSection[] = []

  // ─── Overview (always) ────────────────────────────────────────────────
  const overviewYou: NavItem[] = [
    { href: '/me', label: 'Dashboard', icon: 'overview', keywords: 'home me start' },
    { href: '/me/edit', label: 'Edit my profile', icon: 'edit', keywords: 'name birthday' },
  ]
  if (squishyGuildVisible) {
    overviewYou.push({ href: '/me/games', label: 'My game prefs', icon: 'games', keywords: 'lfg ping roles' })
  }
  const overviewQuick: NavItem[] = []
  if (squishyGuildVisible) {
    overviewQuick.push({ href: '/squishy/voice', label: 'Active voice', icon: 'voice', keywords: 'channels live now' })
  }
  const overviewGeneral: NavItem[] = [
    { href: '/report', label: 'Report a bug', icon: 'report', keywords: 'issue github feedback' },
    { href: '/', label: 'Public status', icon: 'activity', keywords: 'home landing heartbeat', external: true },
  ]
  sections.push({
    id: 'overview',
    label: 'Overview',
    icon: 'overview',
    href: '/me',
    accent: 'violet',
    groups: [
      { heading: 'You', items: overviewYou },
      ...(overviewQuick.length ? [{ heading: 'Live', items: overviewQuick }] : []),
      { heading: 'General', items: overviewGeneral },
    ],
  })

  // ─── Squishy ──────────────────────────────────────────────────────────
  if (showSquishy) {
    sections.push({
      id: 'squishy',
      label: 'Squishy',
      icon: 'squishy',
      href: '/squishy/settings',
      accent: 'aqua',
      groups: [
        {
          heading: 'Configure',
          items: [
            { href: '/squishy/settings', label: 'Settings', icon: 'settings' },
            { href: '/squishy/welcome', label: 'Welcome / Goodbye', icon: 'welcome', keywords: 'greeting farewell' },
            { href: '/squishy/hubs', label: 'Hubs', icon: 'hubs', keywords: 'voice hub channels' },
            { href: '/squishy/games', label: 'Games', icon: 'games', keywords: 'lfg roles' },
            { href: '/squishy/game-night', label: 'Game Night', icon: 'gameNight', keywords: 'schedule post rsvp' },
            { href: '/squishy/profiles', label: 'Profiles', icon: 'profiles', keywords: 'users birthday staff' },
            { href: '/squishy/members', label: 'Members', icon: 'members', keywords: 'directory roles' },
            { href: '/squishy/automation', label: 'Automation', icon: 'automation', keywords: 'reaction roles auto threads socials' },
            { href: '/squishy/roles', label: 'Roles', icon: 'roles', keywords: 'color staff' },
            { href: '/squishy/self-assign-roles', label: 'Self-assign roles', icon: 'roles', keywords: 'self assign reaction roles embed button games auto join' },
          ],
        },
        {
          heading: 'Operate',
          items: [
            { href: '/squishy/voice', label: 'Active voice', icon: 'voice', keywords: 'channels live' },
            { href: '/squishy/archives', label: 'Archives', icon: 'archives' },
            { href: '/squishy/audit', label: 'Audit log', icon: 'audit', keywords: 'history changes' },
          ],
        },
      ],
    })
  }

  // ─── Otter ────────────────────────────────────────────────────────────
  if (showOtter) {
    const otterItems: NavItem[] = [
      { href: '/otter/businesses', label: 'Businesses', icon: 'businesses', keywords: 'portal roster owners' },
    ]
    if (showMke) otterItems.push({ href: '/otter/mke', label: 'MKE', icon: 'mke', keywords: 'mckenzie lookup' })
    otterItems.push({ href: '/otter/oc-stock', label: 'OC Stock', icon: 'stock', keywords: 'original clothing inventory' })
    otterItems.push({ href: '/otter/caked', label: 'Caked', icon: 'caked', keywords: 'caked up bakery' })
    sections.push({
      id: 'otter',
      label: 'Otter',
      icon: 'otter',
      href: '/otter/businesses',
      accent: 'gold',
      groups: [{ items: otterItems }],
    })
  }

  // ─── Sudo ─────────────────────────────────────────────────────────────
  if (showSudo) {
    const adminItems: NavItem[] = []
    if (access.botOwner) {
      adminItems.push(
        { href: '/sudo', label: 'Admin Home', icon: 'sudo', keywords: 'reconciler caches orphan' },
        { href: '/sudo/debug', label: 'Debug', icon: 'debug', keywords: 'introspection runtime' },
        { href: '/sudo/rpc-test', label: 'RPC Test', icon: 'rpc', keywords: 'command bus echo' },
      )
    }
    sections.push({
      id: 'sudo',
      label: 'Sudo',
      icon: 'sudo',
      href: access.botOwner ? '/sudo' : '/audit',
      accent: 'rose',
      groups: [
        ...(adminItems.length ? [{ heading: 'Admin', items: adminItems }] : []),
        {
          heading: 'Observe',
          items: [{ href: '/audit', label: 'Audit Log', icon: 'audit', keywords: 'cross-cutting history' }],
        },
      ],
    })
  }

  return { sections }
}

/** Which section owns a given pathname (for active-state highlighting). */
export function sectionForPath(pathname: string): SectionId {
  if (pathname.startsWith('/squishy')) return 'squishy'
  if (pathname.startsWith('/otter')) return 'otter'
  if (pathname.startsWith('/sudo') || pathname === '/audit') return 'sudo'
  return 'overview'
}

/**
 * The deepest nav item matching `pathname` (longest-prefix wins so `/me`
 * doesn't shadow `/me/edit`). Used for breadcrumbs + active highlighting.
 */
export function findActiveItem(section: NavSection, pathname: string): NavItem | null {
  let best: NavItem | null = null
  for (const group of section.groups) {
    for (const item of group.items) {
      const h = item.href
      const match = h === '/' ? pathname === '/' : pathname === h || pathname.startsWith(`${h}/`)
      if (match && (best === null || h.length > best.href.length)) best = item
    }
  }
  return best
}

export type FlatCommand = NavItem & { section: string }

/** Flatten every nav item across visible sections for the command palette. */
export function flattenCommands(model: NavModel): FlatCommand[] {
  const out: FlatCommand[] = []
  for (const section of model.sections) {
    for (const group of section.groups) {
      for (const item of group.items) {
        out.push({ ...item, section: section.label })
      }
    }
  }
  return out
}

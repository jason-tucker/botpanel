'use client'
/**
 * Sidebar — the single unified navigation column.
 *
 * Replaces the old two-column Discord-style shell (60px icon rail + swapping
 * contextual sidebar). That layout hid every page behind a section hop —
 * you had to know which cryptic rail icon owned the page you wanted. Here
 * EVERYTHING the viewer can see is one click away in one scrollable column:
 *
 *   Brand → Search → [Section ▾ → its items…] × N → Changelog → You
 *
 * Sections are collapsible (chevron on the header row) with the collapsed
 * set persisted in localStorage; the section owning the current route is
 * force-expanded so the active item is always visible. Active item =
 * longest-prefix match (so `/me` doesn't light up on `/me/edit`).
 *
 * Desktop: static 248px column. Mobile: AppFrame renders this same
 * component inside a slide-in drawer (`onClose` present → show ✕).
 */
import { useEffect, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { NavModel, NavSection, SectionAccent } from './nav'
import type { ShellDisplayUser } from './shellTypes'
import { Icon } from '@/components/ui/icons'
import { cn } from '@/components/ui/cn'
import { ChangelogButton } from './ChangelogButton'

const ACCENT_TEXT: Record<SectionAccent, string> = {
  violet: 'text-accent',
  aqua: 'text-aqua',
  gold: 'text-gold',
  rose: 'text-rose',
}

const COLLAPSE_KEY = 'botpanel:nav:collapsed'

function loadCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSE_KEY)
    if (!raw) return new Set()
    const arr = JSON.parse(raw)
    return new Set(Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : [])
  } catch {
    return new Set()
  }
}

function saveCollapsed(ids: Set<string>): void {
  try {
    localStorage.setItem(COLLAPSE_KEY, JSON.stringify(Array.from(ids)))
  } catch {
    // localStorage unavailable (private mode) — collapse just won't persist.
  }
}

/** Longest-prefix active href across the whole nav model. */
function activeHref(nav: NavModel, pathname: string): string | null {
  let best: string | null = null
  for (const section of nav.sections) {
    for (const group of section.groups) {
      for (const item of group.items) {
        const h = item.href
        const match = h === '/' ? pathname === '/' : pathname === h || pathname.startsWith(`${h}/`)
        if (match && (best === null || h.length > best.length)) best = h
      }
    }
  }
  return best
}

function sectionOwns(section: NavSection, href: string | null): boolean {
  if (!href) return false
  return section.groups.some((g) => g.items.some((i) => i.href === href))
}

export function Sidebar({
  nav,
  displayUser,
  onOpenPalette,
  onClose,
  className,
}: {
  nav: NavModel
  displayUser: ShellDisplayUser
  onOpenPalette: () => void
  onClose?: () => void
  className?: string
}) {
  const pathname = usePathname()
  const current = activeHref(nav, pathname)

  // Start expanded on the server render (no flash of missing nav), adopt
  // the persisted collapse set after hydration.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  useEffect(() => {
    setCollapsed(loadCollapsed())
  }, [])

  const toggle = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      saveCollapsed(next)
      return next
    })
  }

  return (
    <aside
      className={cn(
        'flex h-full w-[248px] flex-none flex-col border-r border-line bg-bg-sidebar',
        className,
      )}
    >
      {/* Brand */}
      <div className="flex items-center gap-2.5 px-4 pb-2 pt-4">
        <Link href="/me" onClick={onClose} className="flex min-w-0 flex-1 items-center gap-2.5">
          <span className="flex h-8 w-8 flex-none items-center justify-center rounded-xl bg-accent text-white">
            <Icon name="sparkles" size={17} />
          </span>
          <span className="truncate text-sm font-bold tracking-tight text-ink">Bot Panel</span>
        </Link>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="rounded-lg p-1.5 text-ink-dim hover:bg-bg-hover hover:text-ink"
          >
            <Icon name="close" size={18} />
          </button>
        )}
      </div>

      {/* Search trigger */}
      <div className="px-3 pb-2">
        <button
          type="button"
          onClick={onOpenPalette}
          className="flex w-full items-center gap-2 rounded-xl border border-line bg-bg-card px-3 py-2 text-sm text-ink-faint transition-colors hover:border-line-bright hover:text-ink-dim"
        >
          <Icon name="search" size={15} />
          <span className="flex-1 text-left">Search…</span>
          <kbd className="rounded border border-line bg-bg-app px-1.5 py-0.5 font-mono text-[10px]">⌘K</kbd>
        </button>
      </div>

      {/* Sections */}
      <nav className="flex-1 overflow-y-auto px-2 pb-3">
        {nav.sections.map((section) => {
          const ownsActive = sectionOwns(section, current)
          const isCollapsed = collapsed.has(section.id) && !ownsActive
          return (
            <div key={section.id} className="mt-2 first:mt-0">
              <button
                type="button"
                onClick={() => toggle(section.id)}
                aria-expanded={!isCollapsed}
                className="group flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left hover:bg-bg-hover"
              >
                <Icon name={section.icon} size={15} className={cn('flex-none', ACCENT_TEXT[section.accent])} />
                <span className="flex-1 truncate text-[11px] font-bold uppercase tracking-wider text-ink-dim group-hover:text-ink">
                  {section.label}
                </span>
                <Icon
                  name="chevronRight"
                  size={13}
                  className={cn('flex-none text-ink-faint transition-transform', !isCollapsed && 'rotate-90')}
                />
              </button>

              {!isCollapsed && (
                <div className="mt-0.5 flex flex-col gap-0.5">
                  {section.groups.map((group, gi) => (
                    <div key={gi} className="flex flex-col gap-0.5">
                      {group.heading && section.groups.length > 1 && (
                        <div className="px-3 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
                          {group.heading}
                        </div>
                      )}
                      {group.items.map((item) => {
                        const active = item.href === current
                        return (
                          <Link
                            key={item.href}
                            href={item.href}
                            onClick={onClose}
                            className={cn(
                              'group/item flex items-center gap-2.5 rounded-lg py-1.5 pl-3 pr-2.5 text-sm font-medium transition-colors',
                              active ? 'bg-accent-soft text-ink' : 'text-ink-dim hover:bg-bg-hover hover:text-ink',
                            )}
                          >
                            <Icon
                              name={item.icon}
                              size={16}
                              className={active ? 'text-accent' : 'text-ink-faint group-hover/item:text-ink-dim'}
                            />
                            <span className="flex-1 truncate">{item.label}</span>
                            {item.external && <Icon name="external" size={13} className="text-ink-faint" />}
                          </Link>
                        )
                      })}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </nav>

      {/* Footer: changelog + you */}
      <div className="flex flex-col gap-1 border-t border-line p-2">
        <ChangelogButton />
        <Link
          href="/me"
          onClick={onClose}
          className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 hover:bg-bg-hover"
        >
          <span
            className={cn(
              'flex h-8 w-8 flex-none items-center justify-center overflow-hidden rounded-full bg-bg-raised',
              displayUser.viewAsActive && 'ring-2 ring-err',
            )}
          >
            {displayUser.avatarUrl ? (
              <Image src={displayUser.avatarUrl} alt="" width={32} height={32} className="h-8 w-8 object-cover" />
            ) : (
              <span className="text-xs font-semibold text-ink-dim">
                {displayUser.name.slice(0, 1).toUpperCase()}
              </span>
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-ink">{displayUser.name}</span>
            <span className="block truncate text-[11px] text-ink-faint">
              {displayUser.viewAsActive ? 'Viewing as — click to exit on /me' : 'Your dashboard'}
            </span>
          </span>
        </Link>
      </div>
    </aside>
  )
}

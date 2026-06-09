'use client'
/**
 * SectionSidebar — the contextual second column that shows the active
 * section's nav groups. On desktop it's a static 232px column; on mobile
 * AppFrame renders it inside a slide-in drawer (hence the optional `onClose`).
 *
 * Active-item highlighting uses a longest-prefix match across the section's
 * items so `/me` doesn't also light up while you're on `/me/edit`.
 */
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { NavSection } from './nav'
import { Icon } from '@/components/ui/icons'
import { cn } from '@/components/ui/cn'
import { ChangelogButton } from './ChangelogButton'

const SUBTITLE: Record<string, string> = {
  overview: 'Your account & quick actions',
  squishy: 'Community bot — voice, games, staff',
  otter: 'Business roleplay — staff & stock',
  sudo: 'Cross-cutting admin & observability',
}

function activeHref(section: NavSection, pathname: string): string | null {
  let best: string | null = null
  for (const group of section.groups) {
    for (const item of group.items) {
      const h = item.href
      const match = h === '/' ? pathname === '/' : pathname === h || pathname.startsWith(`${h}/`)
      if (match && (best === null || h.length > best.length)) best = h
    }
  }
  return best
}

export function SectionSidebar({
  section,
  className,
  onClose,
}: {
  section: NavSection
  className?: string
  onClose?: () => void
}) {
  const pathname = usePathname()
  const current = activeHref(section, pathname)

  return (
    <aside
      className={cn(
        'flex h-full w-[232px] flex-none flex-col border-r border-line bg-bg-sidebar',
        className,
      )}
    >
      <div className="flex items-center gap-3 border-b border-line px-4 py-4">
        <div className="flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-accent-soft text-accent">
          <Icon name={section.icon} size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-ink">{section.label}</div>
          <div className="truncate text-[11px] text-ink-dim">{SUBTITLE[section.id]}</div>
        </div>
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

      <nav className="flex-1 overflow-y-auto px-2 py-3">
        {section.groups.map((group, gi) => (
          <div key={gi} className={cn(gi > 0 && 'mt-4')}>
            {group.heading && (
              <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
                {group.heading}
              </div>
            )}
            <div className="flex flex-col gap-0.5">
              {group.items.map((item) => {
                const active = item.href === current
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onClose}
                    className={cn(
                      'group flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                      active
                        ? 'bg-accent-soft text-ink'
                        : 'text-ink-dim hover:bg-bg-hover hover:text-ink',
                    )}
                  >
                    <Icon
                      name={item.icon}
                      size={17}
                      className={active ? 'text-accent' : 'text-ink-faint group-hover:text-ink-dim'}
                    />
                    <span className="flex-1 truncate">{item.label}</span>
                    {item.external && <Icon name="external" size={13} className="text-ink-faint" />}
                  </Link>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-line p-2">
        <ChangelogButton />
      </div>
    </aside>
  )
}

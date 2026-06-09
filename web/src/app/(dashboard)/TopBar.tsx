'use client'
/**
 * TopBar — the sticky header above the content column.
 *
 * Left: mobile drawer toggle + breadcrumb (section › page). Right: the ⌘K
 * search trigger, live bot-health pills, and the user menu. The search
 * control is a button styled as an input so it reads as "click to search"
 * while actually opening the command palette.
 */
import { usePathname } from 'next/navigation'
import type { NavSection } from './nav'
import { findActiveItem } from './nav'
import type { ShellHealth, ShellDisplayUser } from './shellTypes'
import { Icon } from '@/components/ui/icons'
import { BotHealth } from './BotHealth'
import { UserMenu } from './UserMenu'

export function TopBar({
  section,
  health,
  displayUser,
  botOwner,
  viewAsActive,
  onOpenMenu,
  onOpenPalette,
}: {
  section: NavSection
  health: ShellHealth
  displayUser: ShellDisplayUser
  botOwner: boolean
  viewAsActive: boolean
  onOpenMenu: () => void
  onOpenPalette: () => void
}) {
  const pathname = usePathname()
  const active = findActiveItem(section, pathname)

  return (
    <header className="sticky top-0 z-30 flex h-14 flex-none items-center gap-3 border-b border-line bg-bg-app/80 px-3 backdrop-blur-md sm:px-4">
      {/* Mobile: open section drawer */}
      <button
        type="button"
        onClick={onOpenMenu}
        aria-label="Open menu"
        className="md:hidden rounded-lg p-2 text-ink-dim hover:bg-bg-hover hover:text-ink"
      >
        <Icon name="menu" size={20} />
      </button>

      {/* Breadcrumb */}
      <div className="flex min-w-0 items-center gap-1.5">
        <Icon name={section.icon} size={16} className="hidden flex-none text-ink-faint sm:block" />
        <span className="hidden truncate text-sm font-medium text-ink-dim sm:block">{section.label}</span>
        {active && (
          <>
            <Icon name="chevronRight" size={14} className="hidden flex-none text-ink-faint sm:block" />
            <span className="truncate text-sm font-semibold text-ink">{active.label}</span>
          </>
        )}
      </div>

      <div className="ml-auto flex items-center gap-2 sm:gap-3">
        {/* Search / command palette trigger */}
        <button
          type="button"
          onClick={onOpenPalette}
          className="group flex items-center gap-2 rounded-xl border border-line bg-bg-card px-2.5 py-1.5 text-sm text-ink-faint transition-colors hover:border-line-bright hover:text-ink-dim"
          aria-label="Search (Command-K)"
        >
          <Icon name="search" size={15} />
          <span className="hidden lg:inline">Search…</span>
          <kbd className="hidden items-center gap-0.5 rounded border border-line bg-bg-app px-1.5 py-0.5 font-mono text-[10px] text-ink-faint lg:inline-flex">
            ⌘K
          </kbd>
        </button>

        <div className="hidden sm:block">
          <BotHealth initial={health} />
        </div>

        <UserMenu displayUser={displayUser} botOwner={botOwner} viewAsActive={viewAsActive} />
      </div>
    </header>
  )
}

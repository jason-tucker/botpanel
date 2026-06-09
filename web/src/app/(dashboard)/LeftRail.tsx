'use client'
/**
 * LeftRail — the Discord-style icon switcher (leftmost column).
 *
 * Top: the "Overview / home" tile. Divider. Then one tile per top-level
 * section the user can see (Squishy / Otter / Sudo). Bottom: a ⌘K search
 * tile and the user's avatar (links to their dashboard). Each tile has a
 * Discord-style left "pill" indicator that grows on hover and fills on active,
 * plus a hover tooltip. Always visible — even on mobile (it's only 60px) — so
 * section switching is one tap away; the contextual sidebar is what collapses
 * into a drawer.
 */
import Image from 'next/image'
import Link from 'next/link'
import type { NavSection, SectionAccent, SectionId } from './nav'
import type { ShellDisplayUser } from './shellTypes'
import { Icon, type IconName } from '@/components/ui/icons'
import { cn } from '@/components/ui/cn'

const ACTIVE_BG: Record<SectionAccent, string> = {
  violet: 'bg-accent text-white',
  aqua: 'bg-aqua text-black',
  gold: 'bg-gold text-black',
  rose: 'bg-rose text-white',
}

function Tile({
  icon,
  label,
  active,
  accent,
  href,
  onClick,
  avatarUrl,
  ring,
}: {
  icon?: IconName
  label: string
  active?: boolean
  accent?: SectionAccent
  href?: string
  onClick?: () => void
  avatarUrl?: string | null
  ring?: boolean
}) {
  const inner = (
    <span
      className={cn(
        'relative flex h-11 w-11 items-center justify-center transition-all duration-150',
        active
          ? cn('rounded-2xl', accent ? ACTIVE_BG[accent] : 'bg-accent text-white')
          : 'rounded-[14px] bg-bg-raised text-ink-dim hover:rounded-2xl hover:bg-bg-hover hover:text-ink',
        ring && 'ring-2 ring-err ring-offset-2 ring-offset-bg-rail',
      )}
    >
      {avatarUrl !== undefined ? (
        avatarUrl ? (
          <Image
            src={avatarUrl}
            alt=""
            width={36}
            height={36}
            className="h-9 w-9 rounded-[inherit] object-cover"
          />
        ) : (
          <span className="text-sm font-semibold">{label.slice(0, 1).toUpperCase()}</span>
        )
      ) : icon ? (
        <Icon name={icon} size={22} />
      ) : null}
    </span>
  )

  const content = (
    <span className="group relative flex w-full items-center justify-center">
      {/* left pill indicator */}
      <span
        className={cn(
          'absolute left-0 w-1 rounded-r-full bg-white transition-all duration-150',
          active ? 'h-7' : 'h-0 group-hover:h-3.5',
        )}
      />
      {inner}
      {/* tooltip */}
      <span className="pointer-events-none absolute left-full ml-3 z-50 whitespace-nowrap rounded-lg border border-line bg-bg-card px-2.5 py-1.5 text-xs font-medium text-ink opacity-0 shadow-pop transition-opacity duration-100 group-hover:opacity-100">
        {label}
      </span>
    </span>
  )

  if (href) {
    return (
      <Link href={href} aria-label={label} className="flex w-full justify-center">
        {content}
      </Link>
    )
  }
  return (
    <button type="button" onClick={onClick} aria-label={label} className="flex w-full justify-center">
      {content}
    </button>
  )
}

export function LeftRail({
  sections,
  activeSectionId,
  displayUser,
  onOpenPalette,
}: {
  sections: NavSection[]
  activeSectionId: SectionId
  displayUser: ShellDisplayUser
  onOpenPalette: () => void
}) {
  const overview = sections.find((s) => s.id === 'overview')
  const others = sections.filter((s) => s.id !== 'overview')

  return (
    <nav className="flex h-full w-[60px] flex-none flex-col items-center gap-1.5 border-r border-line bg-bg-rail py-3">
      {/* Home / overview */}
      {overview && (
        <Tile
          icon="sparkles"
          label="Overview"
          accent="violet"
          href={overview.href}
          active={activeSectionId === 'overview'}
        />
      )}

      <div className="my-1 h-px w-7 rounded-full bg-line" />

      {/* Sections */}
      <div className="flex flex-1 flex-col items-center gap-1.5 overflow-y-auto no-scrollbar">
        {others.map((s) => (
          <Tile
            key={s.id}
            icon={s.icon}
            label={s.label}
            accent={s.accent}
            href={s.href}
            active={activeSectionId === s.id}
          />
        ))}
      </div>

      {/* Search + avatar */}
      <Tile icon="search" label="Search   ⌘K" onClick={onOpenPalette} />
      <Tile
        label={displayUser.name}
        href="/me"
        avatarUrl={displayUser.avatarUrl}
        ring={displayUser.viewAsActive}
      />
    </nav>
  )
}

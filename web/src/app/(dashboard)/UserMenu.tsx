'use client'
/**
 * UserMenu — the avatar dropdown in the topbar.
 *
 * Sign-out stays a real `<form method="POST">` so it works without JS and
 * matches the existing logout flow. The dropdown closes on outside-click and
 * on Escape. Under View-As the avatar gets a red ring and the menu surfaces
 * the actor identity (the prominent Exit control lives in the banner).
 */
import Image from 'next/image'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { Icon, type IconName } from '@/components/ui/icons'
import { cn } from '@/components/ui/cn'
import type { ShellDisplayUser } from './shellTypes'

function MenuLink({ href, icon, children }: { href: string; icon: IconName; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-ink-dim transition-colors hover:bg-bg-hover hover:text-ink"
    >
      <Icon name={icon} size={16} className="text-ink-faint" />
      {children}
    </Link>
  )
}

export function UserMenu({
  displayUser,
  botOwner,
  viewAsActive,
}: {
  displayUser: ShellDisplayUser
  botOwner: boolean
  viewAsActive: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-full p-0.5 pr-2 transition-colors hover:bg-bg-hover"
      >
        {displayUser.avatarUrl ? (
          <Image
            src={displayUser.avatarUrl}
            alt=""
            width={30}
            height={30}
            className={cn('h-[30px] w-[30px] rounded-full border', viewAsActive ? 'border-err' : 'border-line')}
          />
        ) : (
          <span
            className={cn(
              'flex h-[30px] w-[30px] items-center justify-center rounded-full border bg-bg-raised text-xs text-ink-dim',
              viewAsActive ? 'border-err' : 'border-line',
            )}
          >
            {displayUser.name.slice(0, 1).toUpperCase()}
          </span>
        )}
        <span className="hidden max-w-[120px] truncate text-sm font-medium text-ink lg:block">
          {displayUser.name}
        </span>
        <Icon name="chevronDown" size={14} className="hidden text-ink-faint lg:block" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 w-60 overflow-hidden rounded-xl border border-line bg-bg-card shadow-pop animate-scale-in"
        >
          <div className="border-b border-line px-3 py-3">
            <div className="truncate text-sm font-semibold text-ink">{displayUser.name}</div>
            <div className="mt-0.5 flex items-center gap-1.5">
              {viewAsActive ? (
                <span className="text-[11px] font-medium uppercase tracking-wider text-err">Viewing as</span>
              ) : botOwner ? (
                <span className="text-[11px] font-medium uppercase tracking-wider text-ok">Bot owner</span>
              ) : (
                <span className="truncate font-mono text-[11px] text-ink-faint">{displayUser.id}</span>
              )}
            </div>
          </div>
          <div className="p-1.5">
            <MenuLink href="/me" icon="overview">My dashboard</MenuLink>
            <MenuLink href="/me/edit" icon="edit">Edit profile</MenuLink>
            <MenuLink href="/report" icon="report">Report a bug</MenuLink>
          </div>
          <div className="border-t border-line p-1.5">
            <form action="/api/auth/logout" method="POST">
              <button
                type="submit"
                role="menuitem"
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-ink-dim transition-colors hover:bg-err/10 hover:text-err"
              >
                <Icon name="logout" size={16} />
                Sign out
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

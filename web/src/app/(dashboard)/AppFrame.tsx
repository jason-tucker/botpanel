'use client'
/**
 * AppFrame — the interactive Discord-style shell.
 *
 * Layout (left → right): icon rail → contextual section sidebar → (topbar +
 * scrollable content). The server `DashboardShell` resolves everything and
 * hands this client component a fully-serializable prop bag; AppFrame owns the
 * stateful bits that must live on the client:
 *
 *   - mobile section-drawer open/close
 *   - ⌘K / Ctrl-K command palette
 *   - global toast host
 *
 * Server-rendered page content arrives via `{children}` and is rendered inside
 * the scroll container untouched — every existing page keeps working, just
 * inside nicer chrome.
 */
import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import type { NavModel } from './nav'
import { sectionForPath } from './nav'
import type { ShellHealth, ShellDisplayUser, ShellViewAs } from './shellTypes'
import { LeftRail } from './LeftRail'
import { SectionSidebar } from './SectionSidebar'
import { TopBar } from './TopBar'
import { CommandPalette } from './CommandPalette'
import { ToastHost } from './ToastHost'
import { ViewAsBanner } from './ViewAsBanner'

export function AppFrame({
  nav,
  displayUser,
  viewAs,
  botOwner,
  health,
  children,
}: {
  nav: NavModel
  displayUser: ShellDisplayUser
  viewAs: ShellViewAs
  botOwner: boolean
  health: ShellHealth
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const activeSectionId = sectionForPath(pathname)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setDrawerOpen(false)
  }, [pathname])

  // ⌘K / Ctrl-K toggles the command palette anywhere in the shell.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const activeSection =
    nav.sections.find((s) => s.id === activeSectionId) ?? nav.sections[0]

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-bg-app text-ink">
      {viewAs && (
        <ViewAsBanner viewingUsername={viewAs.viewingName} actorUsername={viewAs.actorName} />
      )}

      <div className="flex min-h-0 flex-1">
        <LeftRail
          sections={nav.sections}
          activeSectionId={activeSectionId}
          displayUser={displayUser}
          onOpenPalette={() => setPaletteOpen(true)}
        />

        {/* Desktop contextual sidebar */}
        <SectionSidebar section={activeSection} className="hidden md:flex" />

        {/* Mobile drawer */}
        <div
          onClick={() => setDrawerOpen(false)}
          aria-hidden={!drawerOpen}
          className={`md:hidden fixed inset-0 z-40 bg-black/60 transition-opacity ${
            drawerOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
          }`}
        />
        <div
          className={`md:hidden fixed inset-y-0 left-[60px] z-50 transition-transform duration-200 ${
            drawerOpen ? 'translate-x-0' : '-translate-x-[120%]'
          }`}
        >
          <SectionSidebar section={activeSection} onClose={() => setDrawerOpen(false)} />
        </div>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <TopBar
            section={activeSection}
            health={health}
            displayUser={displayUser}
            botOwner={botOwner}
            viewAsActive={Boolean(viewAs)}
            onOpenMenu={() => setDrawerOpen(true)}
            onOpenPalette={() => setPaletteOpen(true)}
          />
          <main className="flex-1 overflow-y-auto">{children}</main>
        </div>
      </div>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        sections={nav.sections}
        viewAsActive={Boolean(viewAs)}
      />
      <ToastHost />
    </div>
  )
}

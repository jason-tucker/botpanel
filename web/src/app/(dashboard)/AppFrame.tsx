'use client'
/**
 * AppFrame — the interactive shell around every dashboard page.
 *
 * Layout (left → right): unified sidebar → (topbar + scrollable content).
 * The old two-column Discord-style chrome (icon rail + per-section swapping
 * sidebar) is gone — one sidebar lists everything the viewer can reach, so
 * no page is ever more than a click away. The server `DashboardShell`
 * resolves everything and hands this client component a fully-serializable
 * prop bag; AppFrame owns the stateful bits that must live on the client:
 *
 *   - mobile sidebar drawer open/close
 *   - ⌘K / Ctrl-K command palette (pages + actions + member search)
 *   - global toast host
 *
 * Server-rendered page content arrives via `{children}` and is rendered
 * inside the scroll container untouched.
 */
import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import type { NavModel } from './nav'
import { sectionForPath } from './nav'
import type { ShellHealth, ShellDisplayUser, ShellViewAs } from './shellTypes'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { CommandPalette } from './CommandPalette'
import { ToastHost } from './ToastHost'
import { ViewAsBanner } from './ViewAsBanner'
import { TzDetect } from './TzDetect'

export function AppFrame({
  nav,
  displayUser,
  viewAs,
  botOwner,
  canSearchMembers,
  health,
  children,
}: {
  nav: NavModel
  displayUser: ShellDisplayUser
  viewAs: ShellViewAs
  botOwner: boolean
  canSearchMembers: boolean
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

  const activeSection = nav.sections.find((s) => s.id === activeSectionId) ?? nav.sections[0]

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-bg-app text-ink">
      {viewAs && (
        <ViewAsBanner viewingUsername={viewAs.viewingName} actorUsername={viewAs.actorName} />
      )}

      <div className="flex min-h-0 flex-1">
        {/* Desktop sidebar */}
        <Sidebar
          nav={nav}
          displayUser={displayUser}
          onOpenPalette={() => setPaletteOpen(true)}
          className="hidden md:flex"
        />

        {/* Mobile drawer */}
        <div
          onClick={() => setDrawerOpen(false)}
          aria-hidden={!drawerOpen}
          className={`md:hidden fixed inset-0 z-40 bg-black/60 transition-opacity ${
            drawerOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
          }`}
        />
        <div
          className={`md:hidden fixed inset-y-0 left-0 z-50 transition-transform duration-200 ${
            drawerOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <Sidebar
            nav={nav}
            displayUser={displayUser}
            onOpenPalette={() => {
              setDrawerOpen(false)
              setPaletteOpen(true)
            }}
            onClose={() => setDrawerOpen(false)}
          />
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
        canSearchMembers={canSearchMembers}
      />
      <ToastHost />
      <TzDetect />
    </div>
  )
}

'use client'
/**
 * CommandPalette — ⌘K / Ctrl-K fuzzy launcher.
 *
 * Indexes every nav item the viewer can see (so it respects the same
 * capability gating as the sidebar) plus a couple of stateful actions
 * (Exit View-As, Sign out). Keyboard-first: ↑/↓ to move, Enter to run, Esc to
 * close. Portaled to body so it floats above the rail/sidebar stacking
 * contexts. Opening focuses the input and resets the query.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import type { NavSection } from './nav'
import { flattenCommands } from './nav'
import { Icon, type IconName } from '@/components/ui/icons'
import { cn } from '@/components/ui/cn'

type Command = {
  id: string
  label: string
  section: string
  icon: IconName
  keywords: string
  run: () => void
  danger?: boolean
}

async function getCsrf(): Promise<string | null> {
  try {
    const res = await fetch('/api/csrf', { credentials: 'same-origin' })
    if (!res.ok) return null
    const body = (await res.json()) as { token?: unknown }
    return typeof body.token === 'string' ? body.token : null
  } catch {
    return null
  }
}

export function CommandPalette({
  open,
  onClose,
  sections,
  viewAsActive,
}: {
  open: boolean
  onClose: () => void
  sections: NavSection[]
  viewAsActive: boolean
}) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const commands = useMemo<Command[]>(() => {
    const navCmds: Command[] = flattenCommands({ sections }).map((c) => ({
      id: `nav:${c.href}`,
      label: c.label,
      section: c.section,
      icon: c.icon,
      keywords: c.keywords ?? '',
      run: () => {
        onClose()
        router.push(c.href)
      },
    }))

    const actions: Command[] = []
    if (viewAsActive) {
      actions.push({
        id: 'action:exit-view-as',
        label: 'Exit View-As',
        section: 'Actions',
        icon: 'eye',
        keywords: 'impersonate stop sudo',
        danger: true,
        run: async () => {
          onClose()
          const token = await getCsrf()
          await fetch('/api/sudo/view-as', {
            method: 'DELETE',
            credentials: 'same-origin',
            headers: token ? { 'x-csrf-token': token } : {},
          }).catch(() => {})
          router.refresh()
        },
      })
    }
    actions.push({
      id: 'action:sign-out',
      label: 'Sign out',
      section: 'Actions',
      icon: 'logout',
      keywords: 'logout leave exit',
      danger: true,
      run: () => {
        const form = document.createElement('form')
        form.method = 'POST'
        form.action = '/api/auth/logout'
        document.body.appendChild(form)
        form.submit()
      },
    })
    return [...navCmds, ...actions]
  }, [sections, viewAsActive, router, onClose])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return commands
    const scored = commands
      .map((c) => {
        const hay = `${c.label} ${c.section} ${c.keywords}`.toLowerCase()
        if (!hay.includes(q)) return null
        const starts = c.label.toLowerCase().startsWith(q) ? 0 : 1
        return { c, starts }
      })
      .filter((x): x is { c: Command; starts: number } => x !== null)
      .sort((a, b) => a.starts - b.starts)
    return scored.map((x) => x.c)
  }, [query, commands])

  // Reset + focus on open.
  useEffect(() => {
    if (open) {
      setQuery('')
      setHighlight(0)
      // Defer focus until after the portal paints.
      const t = setTimeout(() => inputRef.current?.focus(), 10)
      return () => clearTimeout(t)
    }
  }, [open])

  // Keep highlight in range as the list filters.
  useEffect(() => {
    setHighlight((h) => Math.min(h, Math.max(0, filtered.length - 1)))
  }, [filtered.length])

  if (!open || typeof document === 'undefined') return null

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlight((h) => (filtered.length ? (h + 1) % filtered.length : 0))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight((h) => (filtered.length ? (h - 1 + filtered.length) % filtered.length : 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      filtered[highlight]?.run()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  return createPortal(
    <div
      onClick={onClose}
      className="fixed inset-0 z-[90] flex items-start justify-center overflow-y-auto bg-black/70 p-4 pt-[12vh] backdrop-blur-sm animate-fade-in"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-line bg-bg-card shadow-2xl animate-scale-in"
      >
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Icon name="search" size={18} className="flex-none text-ink-faint" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Jump to a page or action…"
            className="h-12 w-full bg-transparent text-sm text-ink placeholder:text-ink-faint focus:outline-none"
          />
          <kbd className="flex-none rounded border border-line bg-bg-app px-1.5 py-0.5 font-mono text-[10px] text-ink-faint">
            esc
          </kbd>
        </div>

        <div className="max-h-[52vh] overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-ink-dim">No matches for “{query}”.</div>
          ) : (
            filtered.map((c, i) => {
              const active = i === highlight
              return (
                <button
                  key={c.id}
                  type="button"
                  onMouseMove={() => setHighlight(i)}
                  onClick={() => c.run()}
                  ref={(el) => {
                    if (active && el) el.scrollIntoView({ block: 'nearest' })
                  }}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors',
                    active ? 'bg-accent-soft' : 'hover:bg-bg-hover',
                  )}
                >
                  <Icon
                    name={c.icon}
                    size={17}
                    className={cn(c.danger ? 'text-err' : active ? 'text-accent' : 'text-ink-faint')}
                  />
                  <span className={cn('flex-1 text-sm', c.danger ? 'text-err' : 'text-ink')}>{c.label}</span>
                  <span className="text-[11px] text-ink-faint">{c.section}</span>
                </button>
              )
            })
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

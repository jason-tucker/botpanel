'use client'

/**
 * Sidebar version badge + "What's new" dialog.
 *
 * Rendered in the sidebar footer below "Sign out". Shows the current app
 * version (from `@/lib/changelog`) and, on click, opens a modal listing the
 * curated release notes.
 *
 * The modal is portaled to `document.body` on purpose: the desktop `<aside>`
 * (z-20) and mobile drawer (z-50) each create their own stacking context, so a
 * modal rendered inline would be trapped beneath the rest of the page. The
 * portal lifts it to the top level where `z-[70]` actually wins. The portal is
 * only created while `open` is true (false on the server + first paint), so
 * there's no SSR/hydration access to `document`.
 */
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { APP_VERSION_LABEL, CHANGELOG } from '@/lib/changelog'

export function ChangelogButton() {
  const [open, setOpen] = useState(false)

  // Close on Escape and lock background scroll while the dialog is open.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [open])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        title="What's new"
        className="w-full rounded-md px-1 py-0.5 text-center text-[11px] text-ink-dim/70 transition-colors hover:bg-bg-card2/50 hover:text-ink"
      >
        {APP_VERSION_LABEL} · What&apos;s new
      </button>

      {open &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label="What's new"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-line bg-bg-card shadow-2xl"
            >
              <div className="flex items-center justify-between border-b border-line px-5 py-3">
                <div>
                  <div className="text-sm font-semibold text-ink">What&apos;s new</div>
                  <div className="text-xs text-ink-dim">Botpanel {APP_VERSION_LABEL}</div>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close"
                  className="rounded-lg px-2 py-1 text-ink-dim hover:bg-bg-card2 hover:text-ink"
                >
                  ✕
                </button>
              </div>

              <div className="flex flex-col gap-5 overflow-y-auto px-5 py-4">
                {CHANGELOG.map((entry) => (
                  <section key={entry.version}>
                    <div className="flex items-baseline gap-2">
                      <h3 className="text-sm font-semibold text-ink">v{entry.version}</h3>
                      <span className="text-[11px] text-ink-dim">{entry.date}</span>
                    </div>
                    <ul className="mt-1.5 flex flex-col gap-1.5">
                      {entry.highlights.map((h, i) => (
                        <li key={i} className="flex gap-2 text-xs leading-relaxed text-ink-dim">
                          <span aria-hidden className="select-none text-ink-dim/50">
                            •
                          </span>
                          <span>{h}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}

'use client'
/**
 * Dialog — a portal-mounted modal with backdrop, Escape-to-close, focus
 * containment of body scroll, and an entrance animation.
 *
 * Portaled to `document.body` (like the existing ChangelogButton) so it
 * escapes the sidebar/rail stacking contexts. Render-controlled: the parent
 * owns `open`/`onClose`. The portal only mounts while open, so there's no
 * SSR access to `document`.
 */
import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from './cn'
import { Icon } from './icons'

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  className,
}: {
  open: boolean
  onClose: () => void
  title?: ReactNode
  description?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
  className?: string
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  if (!open || typeof document === 'undefined') return null

  const maxW = {
    sm: 'max-w-sm',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
  }[size]

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-black/70 p-4 pt-[8vh] backdrop-blur-sm animate-fade-in"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={cn(
          'w-full overflow-hidden rounded-2xl border border-line bg-bg-card shadow-2xl animate-scale-in',
          maxW,
          className,
        )}
      >
        {(title || description) && (
          <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
            <div className="min-w-0">
              {title && <div className="text-base font-semibold text-ink">{title}</div>}
              {description && <div className="mt-0.5 text-sm text-ink-dim">{description}</div>}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="-mr-1 -mt-1 rounded-lg p-1.5 text-ink-dim transition-colors hover:bg-bg-hover hover:text-ink"
            >
              <Icon name="close" size={18} />
            </button>
          </div>
        )}
        <div className="px-5 py-4">{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-2 border-t border-line bg-bg-app/40 px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}

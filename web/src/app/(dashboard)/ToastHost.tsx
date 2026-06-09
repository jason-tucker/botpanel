'use client'
/**
 * ToastHost — the single global mount point for `useToast()`.
 *
 * The toast hook (`@/lib/forms/useToast`) is a module-level event bus that any
 * form or client action can `pushToast(...)` into. Until now nothing rendered
 * the queue; mounting this once in the shell means a write anywhere in the app
 * can surface "Saved" / "Failed" feedback without per-page plumbing. Portaled
 * to body so it floats above all stacking contexts.
 */
import { createPortal } from 'react-dom'
import { useToast, type ToastLevel } from '@/lib/forms/useToast'
import { Icon, type IconName } from '@/components/ui/icons'
import { cn } from '@/components/ui/cn'

const LEVEL_STYLE: Record<ToastLevel, { ring: string; icon: IconName; iconColor: string }> = {
  success: { ring: 'border-ok/40', icon: 'check', iconColor: 'text-ok' },
  error: { ring: 'border-err/40', icon: 'warning', iconColor: 'text-err' },
  info: { ring: 'border-accent/40', icon: 'info', iconColor: 'text-accent' },
}

export function ToastHost() {
  const { toasts, dismiss } = useToast()
  if (typeof document === 'undefined') return null

  return createPortal(
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[calc(100vw-2rem)] max-w-sm flex-col gap-2">
      {toasts.map((t) => {
        const style = LEVEL_STYLE[t.level]
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => dismiss(t.id)}
            className={cn(
              'pointer-events-auto flex items-start gap-3 rounded-xl border bg-bg-card px-4 py-3 text-left shadow-pop animate-slide-up',
              style.ring,
            )}
          >
            <Icon name={style.icon} size={18} className={cn('mt-0.5 flex-none', style.iconColor)} />
            <span className="flex-1 text-sm text-ink">{t.message}</span>
            <Icon name="close" size={15} className="mt-0.5 flex-none text-ink-faint" />
          </button>
        )
      })}
    </div>,
    document.body,
  )
}

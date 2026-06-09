/**
 * Feedback + layout primitives: Skeleton, EmptyState, StatCard, PageHeader.
 *
 * Server-safe. These cover the repetitive page-scaffolding shapes (a page
 * title block, a metric tile, an empty list state, a loading placeholder) so
 * every restyled page composes them instead of re-deriving spacing/typography.
 */
import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from './cn'
import { Icon, type IconName } from './icons'

export function Skeleton({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('animate-pulse rounded-lg bg-bg-raised', className)} {...rest} />
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: IconName
  title: string
  description?: string
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-line bg-bg-card/50 px-6 py-12 text-center',
        className,
      )}
    >
      {icon && (
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-bg-raised text-ink-faint">
          <Icon name={icon} size={24} />
        </div>
      )}
      <div className="text-sm font-medium text-ink">{title}</div>
      {description && <div className="max-w-sm text-sm text-ink-dim">{description}</div>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = 'accent',
  className,
}: {
  label: string
  value: ReactNode
  hint?: ReactNode
  icon?: IconName
  tone?: 'accent' | 'success' | 'warning' | 'danger' | 'info' | 'neutral'
  className?: string
}) {
  const toneCls = {
    accent: 'text-accent bg-accent-soft',
    success: 'text-ok bg-ok/10',
    warning: 'text-warn bg-warn/10',
    danger: 'text-err bg-err/10',
    info: 'text-info bg-info/10',
    neutral: 'text-ink-dim bg-bg-raised',
  }[tone]
  return (
    <div className={cn('rounded-2xl border border-line bg-bg-card p-4 shadow-card', className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{label}</span>
        {icon && (
          <span className={cn('flex h-7 w-7 items-center justify-center rounded-lg', toneCls)}>
            <Icon name={icon} size={15} />
          </span>
        )}
      </div>
      <div className="mt-2 text-2xl font-semibold text-ink">{value}</div>
      {hint && <div className="mt-1 text-xs text-ink-dim">{hint}</div>}
    </div>
  )
}

/**
 * PageHeader — the standard title block at the top of a page. `actions` sit
 * on the right on wide screens and wrap below the title on narrow ones.
 */
export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
  icon,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  eyebrow?: ReactNode
  actions?: ReactNode
  icon?: IconName
  className?: string
}) {
  return (
    <header className={cn('flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between', className)}>
      <div className="flex items-start gap-3 min-w-0">
        {icon && (
          <div className="hidden sm:flex h-11 w-11 flex-none items-center justify-center rounded-2xl bg-accent-soft text-accent">
            <Icon name={icon} size={22} />
          </div>
        )}
        <div className="min-w-0">
          {eyebrow && (
            <div className="text-[11px] font-semibold uppercase tracking-wider text-accent">{eyebrow}</div>
          )}
          <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
          {description && <p className="mt-1 text-sm text-ink-dim">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}

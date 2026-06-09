/**
 * Card / surface primitives.
 *
 * Server-safe (no hooks) so they can be used directly in server components.
 * `Card` is the elevated content container; the header/title/body helpers
 * give a consistent rhythm without each page re-deriving padding + type
 * scale. `interactive` adds hover affordance for cards that are links.
 */
import type { HTMLAttributes } from 'react'
import { cn } from './cn'

export function Card({
  className,
  interactive,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { interactive?: boolean }) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-line bg-bg-card shadow-card',
        interactive && 'transition-colors hover:border-accent/60 hover:bg-bg-raised',
        className,
      )}
      {...rest}
    />
  )
}

export function CardHeader({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('flex items-start justify-between gap-3 px-5 pt-5 pb-3', className)}
      {...rest}
    />
  )
}

export function CardTitle({ className, ...rest }: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('text-base font-semibold text-ink', className)} {...rest} />
}

export function CardDescription({ className, ...rest }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-sm text-ink-dim', className)} {...rest} />
}

export function CardBody({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-5 pb-5', className)} {...rest} />
}

export function CardFooter({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('flex items-center gap-2 border-t border-line px-5 py-3', className)}
      {...rest}
    />
  )
}

/**
 * Eyebrow — the small uppercase label used as a section caption throughout
 * the panel ("Capabilities", "Bot status", …). Centralized so the tracking +
 * color stay consistent.
 */
export function Eyebrow({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('text-[11px] font-semibold uppercase tracking-wider text-ink-faint', className)}
      {...rest}
    />
  )
}

/**
 * BarList — ranked label/value rows with a relative-magnitude bar underneath.
 *
 * Server-safe (no hooks). The leaderboard shape used across the stats pages
 * (channels, users, games, emojis): each row is one nominal category, so
 * every bar takes the same single hue (`color`) — never a value-driven ramp
 * on the bars themselves, which would double-encode the length the bar
 * already shows (see dataviz anti-patterns). Rows are optionally links.
 */
import type { ReactNode } from 'react'
import Link from 'next/link'
import { cn } from './cn'

export type BarListItem = {
  label: ReactNode
  value: number
  hint?: string
  href?: string
}

export type BarListProps = {
  items: BarListItem[]
  /** Defaults to the max value found in `items` (min 1, to avoid /0). */
  maxValue?: number
  formatValue?: (v: number) => string
  color?: 'accent' | 'aqua'
  className?: string
}

const BAR_FILL: Record<'accent' | 'aqua', string> = {
  accent: 'bg-accent',
  aqua: 'bg-aqua',
}

function defaultFormat(v: number): string {
  return v.toLocaleString()
}

export function BarList({ items, maxValue, formatValue = defaultFormat, color = 'accent', className }: BarListProps) {
  if (items.length === 0) {
    return <div className={cn('py-6 text-center text-sm text-ink-faint', className)}>No data for this period.</div>
  }

  const effectiveMax = maxValue && maxValue > 0 ? maxValue : Math.max(...items.map((i) => i.value), 1)
  const fillCls = BAR_FILL[color]

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {items.map((item, i) => {
        const pct = Math.min(100, Math.max(0, (item.value / effectiveMax) * 100))
        const row = (
          <>
            <div className="mb-1.5 flex items-center justify-between gap-3">
              <span className="min-w-0 truncate text-sm text-ink">{item.label}</span>
              <span className="shrink-0 text-sm font-medium tabular-nums text-ink">{formatValue(item.value)}</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-bg-raised">
              <div className={cn('h-full rounded-full transition-[width]', fillCls)} style={{ width: `${pct}%` }} />
            </div>
            {item.hint && <div className="mt-1 text-xs text-ink-faint">{item.hint}</div>}
          </>
        )
        const key = `${i}-${typeof item.label === 'string' ? item.label : i}`
        return item.href ? (
          <Link key={key} href={item.href} className="group block rounded-lg -m-1 p-1 transition-colors hover:bg-bg-hover">
            {row}
          </Link>
        ) : (
          <div key={key} className="block">
            {row}
          </div>
        )
      })}
    </div>
  )
}

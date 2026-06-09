'use client'
/**
 * Tabs — a lightweight controlled-or-uncontrolled tab strip.
 *
 * Pure CSS/state, no external dep. Use uncontrolled with `defaultValue`, or
 * lift state with `value`+`onValueChange`. Renders only the active panel.
 */
import { useState, type ReactNode } from 'react'
import { cn } from './cn'

export type TabItem = { value: string; label: ReactNode; count?: number }

export function Tabs({
  items,
  value,
  defaultValue,
  onValueChange,
  className,
  children,
}: {
  items: TabItem[]
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  className?: string
  /** Render-prop: receives the active tab value. */
  children?: (active: string) => ReactNode
}) {
  const [internal, setInternal] = useState(defaultValue ?? items[0]?.value ?? '')
  const active = value ?? internal
  const setActive = (v: string) => {
    if (value === undefined) setInternal(v)
    onValueChange?.(v)
  }

  return (
    <div className={className}>
      <div role="tablist" className="flex items-center gap-1 border-b border-line">
        {items.map((it) => {
          const isActive = it.value === active
          return (
            <button
              key={it.value}
              role="tab"
              type="button"
              aria-selected={isActive}
              onClick={() => setActive(it.value)}
              className={cn(
                'relative -mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'border-accent text-ink'
                  : 'border-transparent text-ink-dim hover:text-ink',
              )}
            >
              {it.label}
              {typeof it.count === 'number' && (
                <span className="rounded-full bg-bg-raised px-1.5 py-0.5 text-[10px] text-ink-dim">
                  {it.count}
                </span>
              )}
            </button>
          )
        })}
      </div>
      {children && <div className="pt-4">{children(active)}</div>}
    </div>
  )
}

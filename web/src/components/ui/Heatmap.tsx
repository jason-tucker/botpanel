/**
 * Heatmap — day-of-week × hour-of-day activity grid.
 *
 * Server-safe (no hooks) so pages can render it directly. Renders a real
 * `<table>` (not a `display:grid` div soup) so it keeps native table
 * semantics for assistive tech — `<caption>` carries `ariaLabel`, hour
 * columns get `scope="col"` headers, day rows get `scope="row"` headers, and
 * every cell carries both a native `title` tooltip (mouse/some AT) *and* a
 * `sr-only` text twin (keyboard/screen-reader, no hover required) — belt and
 * suspenders instead of relying on hover alone. Cell intensity is the
 * `accent`/`aqua` token at an opacity derived from `value / maxValue`
 * (single-hue sequential ramp, never a rainbow); zero-value cells fall back
 * to `bg-bg-raised` so the grid stays legible with no data at all. A
 * `overflow-x-auto` wrapper keeps 24 columns from crushing the layout on
 * narrow screens.
 *
 * Input `dow` is Postgres-style, 0 = Sunday. Display is Monday-first
 * (Mon…Sun) — the reorder happens entirely inside this component.
 */
import { cn } from './cn'

export type HeatmapCell = { dow: number; hour: number; value: number }

export type HeatmapProps = {
  /** Sparse is fine — any (dow, hour) not present is treated as 0. */
  cells: HeatmapCell[]
  /** Defaults to the max value found in `cells` (min 1, to avoid /0). */
  maxValue?: number
  /** Overall description for the table `<caption>` (screen-reader + sr-only, visually hidden). */
  ariaLabel: string
  color?: 'accent' | 'aqua'
  className?: string
}

const DOW_LABELS: Record<number, string> = {
  0: 'Sun',
  1: 'Mon',
  2: 'Tue',
  3: 'Wed',
  4: 'Thu',
  5: 'Fri',
  6: 'Sat',
}

/** Monday-first display order; incoming `dow` stays Postgres 0=Sunday. */
const DOW_ORDER = [1, 2, 3, 4, 5, 6, 0]
const HOURS = Array.from({ length: 24 }, (_, i) => i)

const CELL_BG: Record<'accent' | 'aqua', string> = {
  accent: 'bg-accent',
  aqua: 'bg-aqua',
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

export function Heatmap({ cells, maxValue, ariaLabel, color = 'accent', className }: HeatmapProps) {
  const byKey = new Map<string, number>()
  let observedMax = 0
  for (const c of cells) {
    byKey.set(`${c.dow}:${c.hour}`, c.value)
    if (c.value > observedMax) observedMax = c.value
  }
  const effectiveMax = maxValue && maxValue > 0 ? maxValue : Math.max(observedMax, 1)
  const cellBgCls = CELL_BG[color]

  return (
    <div className={cn('w-full overflow-x-auto', className)}>
      <table className="min-w-max border-separate" style={{ borderSpacing: '3px' }}>
        <caption className="sr-only">{ariaLabel}</caption>
        <thead>
          <tr>
            <th scope="col" className="w-9" aria-hidden="true" />
            {HOURS.map((hour) => (
              <th key={hour} scope="col" className="p-0 pb-1 align-bottom font-normal">
                {hour % 3 === 0 ? (
                  <span className="block text-center text-[9px] leading-none text-ink-faint">{hour}</span>
                ) : (
                  <span className="sr-only">{pad2(hour)}:00</span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {DOW_ORDER.map((dow) => (
            <tr key={dow}>
              <th
                scope="row"
                className="whitespace-nowrap pr-2 text-right align-middle text-[10px] font-normal text-ink-faint"
              >
                {DOW_LABELS[dow]}
              </th>
              {HOURS.map((hour) => {
                const value = byKey.get(`${dow}:${hour}`) ?? 0
                const ratio = value > 0 ? Math.min(1, value / effectiveMax) : 0
                const opacity = value > 0 ? Math.min(1, 0.16 + ratio * 0.84) : undefined
                const label = `${DOW_LABELS[dow]} ${pad2(hour)}:00 — ${value.toLocaleString()}`
                return (
                  <td key={hour} className="p-0" title={label}>
                    <div
                      className={cn('h-3.5 w-3.5 rounded-[3px]', value > 0 ? cellBgCls : 'bg-bg-raised')}
                      style={opacity !== undefined ? { opacity } : undefined}
                      aria-hidden="true"
                    />
                    <span className="sr-only">{label}</span>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

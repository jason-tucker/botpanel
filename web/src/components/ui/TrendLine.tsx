/**
 * TrendLine — inline SVG area+line sparkline.
 *
 * Server-safe (no hooks). No axes, no gridlines, no legend box — a single
 * series needs none (the caller's card title already names it). Responsive
 * via `viewBox` scaling rather than a measured pixel width — which means the
 * x/y scale factors differ at most container widths, so the end-marker is
 * NOT drawn as an SVG `<circle>` (it would render as an ellipse under
 * non-uniform scaling); it's a small absolutely-positioned HTML dot laid
 * over the svg instead, positioned by percentage so it stays perfectly
 * round and carries a real `ring-2 ring-bg-card` surface ring. Line is 2px
 * with round joins/caps, the area fill is the same hue at ~10% opacity (a
 * wash, per house mark spec). An SVG `<title>` doubles as a native tooltip
 * for `ariaLabel` — no client JS required.
 */
import { cn } from './cn'

export type TrendLinePoint = { t: number; value: number }

export type TrendLineProps = {
  points: TrendLinePoint[]
  height?: number
  color?: 'accent' | 'aqua' | 'ok'
  ariaLabel: string
  className?: string
}

const STROKE: Record<'accent' | 'aqua' | 'ok', string> = {
  accent: 'stroke-accent',
  aqua: 'stroke-aqua',
  ok: 'stroke-ok',
}
const FILL_WASH: Record<'accent' | 'aqua' | 'ok', string> = {
  accent: 'fill-accent/10',
  aqua: 'fill-aqua/10',
  ok: 'fill-ok/10',
}
const DOT_BG: Record<'accent' | 'aqua' | 'ok', string> = {
  accent: 'bg-accent',
  aqua: 'bg-aqua',
  ok: 'bg-ok',
}

const VIEW_W = 400

export function TrendLine({ points, height = 64, color = 'accent', ariaLabel, className }: TrendLineProps) {
  const sorted = [...points].sort((a, b) => a.t - b.t)

  if (sorted.length === 0) {
    return (
      <div
        className={cn('flex items-center justify-center text-xs text-ink-faint', className)}
        style={{ height }}
      >
        No data
      </div>
    )
  }

  const values = sorted.map((p) => p.value)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const n = sorted.length
  const padY = 6
  const plotH = Math.max(height - padY * 2, 1)

  const x = (i: number) => (n === 1 ? VIEW_W / 2 : (i / (n - 1)) * VIEW_W)
  // A perfectly flat series (max === min) centers vertically — mapping it to
  // (v - min) / range = 0 would pin a stable value to the bottom edge, which
  // reads as "zero".
  const y = (v: number) => (max === min ? padY + plotH / 2 : padY + (1 - (v - min) / range) * plotH)

  const linePath = sorted.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(2)},${y(p.value).toFixed(2)}`).join(' ')
  const areaPath = `${linePath} L${x(n - 1).toFixed(2)},${height} L${x(0).toFixed(2)},${height} Z`

  const lastX = x(n - 1)
  const lastY = y(sorted[n - 1].value)
  const lastXPct = (lastX / VIEW_W) * 100
  const lastYPct = (lastY / height) * 100

  return (
    <div className={cn('relative w-full', className)} style={{ height }}>
      <svg
        viewBox={`0 0 ${VIEW_W} ${height}`}
        width="100%"
        height={height}
        preserveAspectRatio="none"
        role="img"
        aria-label={ariaLabel}
        className="block overflow-visible"
      >
        <title>{ariaLabel}</title>
        <path d={areaPath} className={FILL_WASH[color]} stroke="none" />
        <path
          d={linePath}
          className={STROKE[color]}
          fill="none"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {/* HTML overlay (not an SVG <circle>) so the marker stays round under the
          chart's non-uniform x/y scaling; ring-2 ring-bg-card is the surface ring. */}
      <span
        aria-hidden="true"
        className={cn(
          'absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-bg-card',
          DOT_BG[color],
        )}
        style={{ left: `${lastXPct}%`, top: `${lastYPct}%` }}
      />
    </div>
  )
}

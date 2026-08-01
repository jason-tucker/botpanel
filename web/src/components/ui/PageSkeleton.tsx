/**
 * PageSkeleton — shared content-area loading placeholder.
 *
 * Rendered by the per-segment `loading.tsx` files so every navigation gets
 * instant visual feedback shaped roughly like the page it's waiting for,
 * instead of a frozen click (or one generic top-level skeleton for the whole
 * app). Server component, pure CSS animation.
 *
 * Variants map to the three page shapes the dashboard actually has:
 *  - 'stats'  — KPI tile row + two chart/list cards (stats overview, user &
 *               channel detail, auto-voice breakdown)
 *  - 'table'  — search bar + row list (directories: profiles, members, audit)
 *  - 'detail' — header chip + two stacked cards (single-record pages)
 */
function Bar({ className = '' }: { className?: string }) {
  return <div className={`rounded bg-bg-card2 ${className}`} />
}

function KpiTile() {
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-line bg-bg-card p-4">
      <Bar className="h-3 w-1/3" />
      <Bar className="h-6 w-1/2" />
      <Bar className="h-3 w-2/3" />
    </div>
  )
}

function ListCard({ rows = 6 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-line bg-bg-card p-4">
      <Bar className="h-4 w-1/4" />
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Bar className="h-3 flex-1" />
          <Bar className="h-3 w-12" />
        </div>
      ))}
    </div>
  )
}

export function PageSkeleton({ variant = 'stats' }: { variant?: 'stats' | 'table' | 'detail' }) {
  return (
    <div
      className="mx-auto flex max-w-6xl flex-col gap-5 p-6 pt-16 sm:p-10 md:pt-10 animate-pulse"
      aria-busy="true"
      aria-live="polite"
    >
      <div className="flex flex-col gap-2">
        <Bar className="h-3 w-24" />
        <Bar className="h-7 w-64 max-w-full" />
        <Bar className="h-4 w-96 max-w-full" />
      </div>

      {variant === 'stats' && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <KpiTile key={i} />
            ))}
          </div>
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <ListCard rows={7} />
            <ListCard rows={7} />
          </div>
        </>
      )}

      {variant === 'table' && (
        <>
          <Bar className="h-10 w-full max-w-md rounded-xl" />
          <ListCard rows={10} />
        </>
      )}

      {variant === 'detail' && (
        <>
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 flex-none rounded-full bg-bg-card2" />
            <div className="flex flex-1 flex-col gap-2">
              <Bar className="h-5 w-48" />
              <Bar className="h-3 w-32" />
            </div>
          </div>
          <ListCard rows={5} />
          <ListCard rows={5} />
        </>
      )}
    </div>
  )
}

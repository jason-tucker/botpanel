/**
 * Generic dashboard-shell loading skeleton.
 *
 * Next.js's App Router renders this whenever a `(dashboard)/*` page's server
 * component is suspended (e.g. on first navigation, before the page resolves
 * its session + DB calls). Without it, viewers see a blank flash between
 * route transitions — particularly noticeable on the heavier pages
 * (`/audit`, `/squishy/voice`) where the first paint is gated on a DB read.
 *
 * The skeleton mirrors the dashboard chrome (192px left rail on `md+`,
 * full-bleed main column) so the layout doesn't reflow when the real page
 * finally paints. Per-route `loading.tsx` files can override this with a
 * page-specific skeleton — but a sensible default is enough for MVP.
 *
 * Server component, no interactivity. Animation is pure CSS via Tailwind's
 * `animate-pulse`.
 */

function SkeletonLine({ className = '' }: { className?: string }) {
  return <div className={`rounded bg-bg-card2 ${className}`} />
}

export default function DashboardLoading() {
  return (
    <div className="min-h-dvh bg-bg animate-pulse" aria-busy="true" aria-live="polite">
      {/* Left rail placeholder — matches the 192px fixed sidebar. */}
      <aside className="hidden md:flex fixed inset-y-0 left-0 w-48 border-r border-line bg-bg-card flex-col">
        <div className="px-4 pt-5 pb-4 border-b border-line flex flex-col gap-2">
          <SkeletonLine className="h-5 w-24" />
          <SkeletonLine className="h-3 w-32" />
        </div>
        <div className="flex-1 px-2 py-2 flex flex-col gap-1.5">
          {Array.from({ length: 8 }).map((_, i) => (
            <SkeletonLine key={i} className="h-8" />
          ))}
        </div>
        <div className="border-t border-line p-3 flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-bg-card2" />
          <SkeletonLine className="h-3 flex-1" />
        </div>
      </aside>

      {/* Main column placeholder. */}
      <main className="md:pl-48 min-h-dvh">
        <div className="p-6 flex flex-col gap-4 max-w-5xl">
          <SkeletonLine className="h-7 w-48" />
          <SkeletonLine className="h-4 w-72" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-line bg-bg-card p-4 flex flex-col gap-2">
                <SkeletonLine className="h-4 w-1/3" />
                <SkeletonLine className="h-3 w-2/3" />
                <SkeletonLine className="h-3 w-1/2" />
              </div>
            ))}
          </div>
          <div className="rounded-xl border border-line bg-bg-card p-4 flex flex-col gap-2 mt-2">
            <SkeletonLine className="h-4 w-1/4" />
            {Array.from({ length: 5 }).map((_, i) => (
              <SkeletonLine key={i} className="h-3 w-full" />
            ))}
          </div>
        </div>
      </main>
    </div>
  )
}

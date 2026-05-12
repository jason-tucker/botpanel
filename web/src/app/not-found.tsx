import Link from 'next/link'

/**
 * Root 404 page.
 *
 * Lives at the top-level (not inside the `(dashboard)` group) so it covers
 * BOTH unauthenticated misses (e.g. `/foo`) and authenticated misses inside
 * the dashboard. Matches the dark-theme palette used everywhere else.
 *
 * Intentionally a server component with no DB / session calls — a 404 should
 * render even if everything else is on fire.
 */
export default function NotFound() {
  return (
    <main className="min-h-dvh flex items-center justify-center p-6 bg-bg">
      <div className="w-full max-w-md rounded-2xl border border-line bg-bg-card p-6 flex flex-col gap-4 text-center">
        <div className="text-[10px] uppercase tracking-wider text-ink-dim/70">404</div>
        <h1 className="text-2xl font-semibold text-ink">Page not found.</h1>
        <p className="text-ink-dim text-sm">
          The page you’re looking for doesn’t exist, or it moved during a recent refactor.
        </p>
        <div className="flex items-center justify-center gap-2 pt-1">
          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-lg bg-accent text-white font-semibold px-4 py-2.5"
          >
            Back to dashboard
          </Link>
        </div>
      </div>
    </main>
  )
}

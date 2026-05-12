'use client'

/**
 * Dashboard-shell error boundary.
 *
 * Catches any uncaught error thrown by a `(dashboard)/*` page's render —
 * server component throws are caught here too via Next.js's RSC error
 * plumbing, which surfaces them to the nearest client boundary. The page
 * itself is wrapped by the dashboard layout (sidebar + chrome), so we don't
 * need to re-render those bits here; we just fill the main slot with a
 * red-toned card.
 *
 * Per the Next.js App Router contract, this file MUST be a client component
 * and MUST export `default` with the `{ error, reset }` props shape. `reset`
 * re-runs the page's render pipeline without a full reload, which usually
 * succeeds on transient errors (e.g. a momentary DB blip).
 *
 * `digest` is the redacted error fingerprint Next.js attaches in production;
 * we render it for support-ticket cross-referencing. The full message is
 * always shown — this dashboard isn't user-facing in any privacy-sensitive
 * sense, and a visible stack trace beats silent corruption every time.
 */
import Link from 'next/link'
import { useEffect } from 'react'

interface DashboardErrorProps {
  error: Error & { digest?: string }
  reset: () => void
}

export default function DashboardError({ error, reset }: DashboardErrorProps) {
  useEffect(() => {
    // Server-side errors already get logged by Next.js's framework logger;
    // this catches client-thrown errors that wouldn't otherwise surface.
    console.error('dashboard error boundary caught:', error)
  }, [error])

  return (
    <div className="p-6 sm:p-10 flex justify-center">
      <div className="w-full max-w-xl rounded-2xl border border-red-900 bg-red-950/30 p-6 flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <span aria-hidden className="text-base leading-none">⚠</span>
          <h1 className="text-lg font-semibold text-red-100">Something went wrong</h1>
        </div>

        <div className="rounded-lg border border-red-900/60 bg-bg-card2/80 p-3 text-sm text-red-200 font-mono break-words">
          {error.message || 'Unknown error'}
        </div>

        {error.digest && (
          <div className="text-[11px] text-ink-dim font-mono">
            digest: <span className="text-ink-dim">{error.digest}</span>
          </div>
        )}

        <p className="text-ink-dim text-sm">
          You can retry the failed render, or head back to the public home page.
        </p>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            type="button"
            onClick={() => reset()}
            className="inline-flex items-center justify-center rounded-lg bg-accent text-white font-semibold px-4 py-2.5"
          >
            Try again
          </button>
          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-lg border border-line bg-bg-card2 text-ink hover:bg-bg-card px-4 py-2.5 text-sm font-medium"
          >
            Back to home
          </Link>
        </div>
      </div>
    </div>
  )
}

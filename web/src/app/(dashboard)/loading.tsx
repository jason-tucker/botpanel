/**
 * Generic dashboard content skeleton.
 *
 * Next.js's App Router renders this whenever a `(dashboard)/*` page's server
 * component is suspended (first navigation, before the page resolves its
 * session + DB calls). It now renders INSIDE the new app shell's `<main>`
 * scroll area — the rail / contextual sidebar / topbar stay put — so this is
 * purely a content-area placeholder (no fake chrome, no fixed positioning).
 *
 * Server component, no interactivity. Animation is pure CSS via Tailwind's
 * `animate-pulse`.
 */
function Bar({ className = '' }: { className?: string }) {
  return <div className={`rounded bg-bg-card2 ${className}`} />
}

export default function DashboardLoading() {
  return (
    <div
      className="flex flex-col gap-4 p-6 pt-16 sm:p-10 md:pt-10 animate-pulse"
      aria-busy="true"
      aria-live="polite"
    >
      <Bar className="h-7 w-52" />
      <Bar className="h-4 w-80 max-w-full" />

      <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-2 rounded-2xl border border-line bg-bg-card p-4">
            <Bar className="h-4 w-1/3" />
            <Bar className="h-6 w-1/2" />
            <Bar className="h-3 w-2/3" />
          </div>
        ))}
      </div>

      <div className="mt-2 flex flex-col gap-2 rounded-2xl border border-line bg-bg-card p-4">
        <Bar className="h-4 w-1/4" />
        {Array.from({ length: 5 }).map((_, i) => (
          <Bar key={i} className="h-3 w-full" />
        ))}
      </div>
    </div>
  )
}

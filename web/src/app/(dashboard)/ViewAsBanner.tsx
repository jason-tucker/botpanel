'use client'

/**
 * Sticky top-of-page banner that announces an active View-As session.
 *
 * Server-rendered visibility is decided by the layout — it only renders
 * this component when `access.actor.id !== access.viewing.id`, so this
 * file doesn't need to gate on anything else.
 *
 * The Exit button DELETEs `/api/sudo/view-as`. We bypass `<ServerForm>`
 * here so the banner can live above the main content without dragging
 * the form's max-width / styling assumptions onto a full-bleed surface.
 * We still pull the CSRF token via a one-shot fetch on click — same
 * underlying double-submit pattern.
 *
 * Colors: `bg-err` background with `bg-err/95` so a thin line of body
 * shows through and the banner reads as "stuck to the top edge" rather
 * than as part of the page. Z-index sits above the desktop sidebar
 * (`z-20`) and below the mobile drawer (`z-40` backdrop / `z-50`
 * drawer) so the banner shows on desktop AND the drawer can still
 * cover it on mobile when explicitly opened.
 */
import { useRouter } from 'next/navigation'
import { useState } from 'react'

async function getCsrf(): Promise<string | null> {
  try {
    const res = await fetch('/api/csrf', {
      method: 'GET',
      credentials: 'same-origin',
    })
    if (!res.ok) return null
    const body = (await res.json()) as { token?: unknown }
    return typeof body.token === 'string' ? body.token : null
  } catch {
    return null
  }
}

export function ViewAsBanner({
  viewingUsername,
  actorUsername,
}: {
  viewingUsername: string
  actorUsername: string
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function exit() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const token = await getCsrf()
      const res = await fetch('/api/sudo/view-as', {
        method: 'DELETE',
        credentials: 'same-origin',
        headers: token ? { 'x-csrf-token': token } : {},
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        setError(body?.error ?? `exit-failed (${res.status})`)
        setBusy(false)
        return
      }
      router.push('/sudo')
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'network')
      setBusy(false)
    }
  }

  return (
    <div className="relative z-40 flex-none bg-err text-white shadow-md">
      <div className="px-4 md:px-6 py-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="flex-1 min-w-0">
          Viewing as <span className="font-semibold">@{viewingUsername}</span>
          {' — '}
          your changes audit as your real account →{' '}
          <span className="font-mono text-xs">@{actorUsername}</span>.
        </span>
        <button
          type="button"
          onClick={exit}
          disabled={busy}
          className="rounded border border-ink/30 bg-ink/10 px-3 py-1 text-xs font-semibold hover:bg-ink/20 disabled:opacity-50"
        >
          {busy ? 'Exiting…' : 'Exit'}
        </button>
        {error && (
          <span className="basis-full text-[11px] text-ink/80" role="alert">
            {error}
          </span>
        )}
      </div>
    </div>
  )
}

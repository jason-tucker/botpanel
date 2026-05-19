'use client'

/**
 * <PushOptIn> — Web Push subscribe/unsubscribe toggle card.
 *
 * Renders one of five states, with a button on the right:
 *   1. Unsupported               — browser missing PushManager / SW
 *   2. Permission denied         — user clicked "Block" earlier; we
 *                                   can't re-prompt programmatically;
 *                                   show the user how to fix it in
 *                                   site settings.
 *   3. Not subscribed            — "Enable notifications" button
 *   4. Subscribed                — "Disable notifications" button
 *   5. Misconfigured (server)    — `NEXT_PUBLIC_VAPID_PUBLIC` not set
 *                                   at build time → nothing to send
 *                                   to the push service. Show an ops
 *                                   message instead of a dead button.
 *
 * Persistence: the subscription itself lives on the push service +
 * `push_subscriptions` table; we don't keep a local cache. Every
 * mount calls `serviceWorker.getRegistration()` →
 * `pushManager.getSubscription()` to know if there's an existing
 * subscription for this browser. That keeps the UI consistent across
 * browsers + after a manual revoke in browser settings.
 *
 * CSRF: posts via fetch include the `x-csrf-token` header pulled from
 * `GET /api/csrf` — mirrors the pattern in `WelcomeEditor.tsx`.
 */
import { useCallback, useEffect, useState } from 'react'

type ViewState =
  | { kind: 'loading' }
  | { kind: 'unsupported'; reason: string }
  | { kind: 'misconfigured' }
  | { kind: 'denied' }
  | { kind: 'idle' }
  | { kind: 'subscribed'; endpoint: string }

const VAPID_PUBLIC: string | undefined = process.env.NEXT_PUBLIC_VAPID_PUBLIC

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  // Web Push wants the applicationServerKey as a raw Uint8Array of
  // the URL-safe base64 public key. The browser does NOT accept the
  // string directly — every tutorial trips on this.
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; ++i) out[i] = raw.charCodeAt(i)
  return out
}

async function getCsrfToken(): Promise<string | null> {
  try {
    const r = await fetch('/api/csrf', { credentials: 'same-origin' })
    if (!r.ok) return null
    const body = (await r.json()) as { token?: string }
    return body.token ?? null
  } catch {
    return null
  }
}

export function PushOptIn({ className }: { className?: string }) {
  const [state, setState] = useState<ViewState>({ kind: 'loading' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Detect support + existing subscription on mount.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (typeof window === 'undefined') return
      if (!('serviceWorker' in navigator)) {
        if (!cancelled) setState({ kind: 'unsupported', reason: 'no-service-worker' })
        return
      }
      if (!('PushManager' in window)) {
        if (!cancelled) setState({ kind: 'unsupported', reason: 'no-push-manager' })
        return
      }
      if (!('Notification' in window)) {
        if (!cancelled) setState({ kind: 'unsupported', reason: 'no-notifications' })
        return
      }
      if (!VAPID_PUBLIC) {
        if (!cancelled) setState({ kind: 'misconfigured' })
        return
      }
      if (Notification.permission === 'denied') {
        if (!cancelled) setState({ kind: 'denied' })
        return
      }
      try {
        const reg = await navigator.serviceWorker.getRegistration('/sw.js')
        if (!reg) {
          if (!cancelled) setState({ kind: 'idle' })
          return
        }
        const existing = await reg.pushManager.getSubscription()
        if (existing) {
          if (!cancelled) setState({ kind: 'subscribed', endpoint: existing.endpoint })
        } else {
          if (!cancelled) setState({ kind: 'idle' })
        }
      } catch {
        if (!cancelled) setState({ kind: 'idle' })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const onSubscribe = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      if (!VAPID_PUBLIC) {
        setError('Operator has not set NEXT_PUBLIC_VAPID_PUBLIC.')
        return
      }
      // Ask permission first. We don't try to be clever here — a
      // single explicit ask is the standard pattern, and the user
      // already clicked the button so the timing isn't surprising.
      const perm = await Notification.requestPermission()
      if (perm !== 'granted') {
        setState({ kind: perm === 'denied' ? 'denied' : 'idle' })
        return
      }
      // Register the SW lazily — first time only. The browser dedupes
      // subsequent register() calls on the same script URL.
      const reg = await navigator.serviceWorker.register('/sw.js')
      // Make sure the SW is active before we ask for a subscription;
      // pushManager.subscribe on a `installing` registration races.
      await navigator.serviceWorker.ready
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC),
      })
      const json = sub.toJSON()
      const csrf = await getCsrfToken()
      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'content-type': 'application/json',
          ...(csrf ? { 'x-csrf-token': csrf } : {}),
        },
        body: JSON.stringify({
          endpoint: json.endpoint,
          keys: json.keys,
        }),
      })
      if (!res.ok) {
        // Roll back the local subscription so the next mount doesn't
        // show "subscribed" with no server-side row.
        try {
          await sub.unsubscribe()
        } catch {
          // best-effort
        }
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        setError(body?.error ?? `HTTP ${res.status}`)
        setState({ kind: 'idle' })
        return
      }
      setState({ kind: 'subscribed', endpoint: sub.endpoint })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'subscribe failed')
    } finally {
      setBusy(false)
    }
  }, [])

  const onUnsubscribe = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const reg = await navigator.serviceWorker.getRegistration('/sw.js')
      const sub = reg ? await reg.pushManager.getSubscription() : null
      const endpoint = sub?.endpoint ?? (state.kind === 'subscribed' ? state.endpoint : null)
      if (sub) {
        try {
          await sub.unsubscribe()
        } catch {
          // Even if browser-side unsubscribe fails, drop the row server-side.
        }
      }
      if (endpoint) {
        const csrf = await getCsrfToken()
        await fetch('/api/push/subscribe', {
          method: 'DELETE',
          credentials: 'same-origin',
          headers: {
            'content-type': 'application/json',
            ...(csrf ? { 'x-csrf-token': csrf } : {}),
          },
          body: JSON.stringify({ endpoint }),
        }).catch(() => {
          /* best-effort */
        })
      }
      setState({ kind: 'idle' })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'unsubscribe failed')
    } finally {
      setBusy(false)
    }
  }, [state])

  return (
    <section
      className={
        'rounded-2xl border border-line bg-bg-card p-5 flex flex-col gap-3 ' +
        (className ?? '')
      }
    >
      <header className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold">Browser notifications</h2>
        <span className="text-xs text-ink-dim">
          Web Push (per-browser)
        </span>
      </header>
      <p className="text-sm text-ink-dim">
        Get a native browser notification when a new staff approval is
        filed or a new <code className="font-mono">/report</code>{' '}
        arrives. Subscriptions are per-browser — enable on each device
        you want to be paged on.
      </p>

      <div className="flex flex-wrap items-center gap-3 pt-1">
        <StateBadge state={state} />

        {state.kind === 'idle' && (
          <button
            type="button"
            disabled={busy}
            onClick={onSubscribe}
            className="rounded-lg border border-line bg-bg-card2 hover:border-accent hover:text-accent disabled:opacity-50 px-3 py-1.5 text-sm transition-colors"
          >
            {busy ? 'Enabling…' : 'Enable notifications'}
          </button>
        )}

        {state.kind === 'subscribed' && (
          <button
            type="button"
            disabled={busy}
            onClick={onUnsubscribe}
            className="rounded-lg border border-line bg-bg-card2 hover:border-warn hover:text-warn disabled:opacity-50 px-3 py-1.5 text-sm transition-colors"
          >
            {busy ? 'Disabling…' : 'Disable notifications'}
          </button>
        )}

        {state.kind === 'denied' && (
          <span className="text-xs text-ink-dim">
            You blocked notifications for this site — re-enable in your
            browser&apos;s site settings, then refresh.
          </span>
        )}

        {state.kind === 'unsupported' && (
          <span className="text-xs text-ink-dim">
            This browser doesn&apos;t support Web Push
            {state.reason === 'no-service-worker' ? ' (no Service Worker API)' : ''}
            {state.reason === 'no-push-manager' ? ' (no PushManager)' : ''}
            {state.reason === 'no-notifications' ? ' (no Notification API)' : ''}.
            On iPhone / iPad you must install the panel as a PWA
            (Share → Add to Home Screen) and open it from there to
            get push.
          </span>
        )}

        {state.kind === 'misconfigured' && (
          <span className="text-xs text-warn">
            Server isn&apos;t configured for push (operator must set{' '}
            <code className="font-mono">VAPID_PUBLIC</code> /{' '}
            <code className="font-mono">VAPID_PRIVATE</code> /{' '}
            <code className="font-mono">NEXT_PUBLIC_VAPID_PUBLIC</code>).
          </span>
        )}
      </div>

      {error && (
        <p className="text-xs text-warn">
          {error}
        </p>
      )}
    </section>
  )
}

function StateBadge({ state }: { state: ViewState }) {
  const labelClass = 'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs'
  switch (state.kind) {
    case 'loading':
      return (
        <span className={`${labelClass} border-line bg-bg-card2 text-ink-dim`}>
          <span className="w-2 h-2 rounded-full bg-ink-dim/50" />
          Checking…
        </span>
      )
    case 'subscribed':
      return (
        <span className={`${labelClass} border-ok/40 bg-ok/10 text-ok`}>
          <span className="w-2 h-2 rounded-full bg-ok" />
          Subscribed on this browser
        </span>
      )
    case 'idle':
      return (
        <span className={`${labelClass} border-line bg-bg-card2 text-ink-dim`}>
          <span className="w-2 h-2 rounded-full bg-ink-dim/60" />
          Not subscribed
        </span>
      )
    case 'denied':
      return (
        <span className={`${labelClass} border-warn/40 bg-warn/10 text-warn`}>
          <span className="w-2 h-2 rounded-full bg-warn" />
          Blocked by browser
        </span>
      )
    case 'unsupported':
      return (
        <span className={`${labelClass} border-line bg-bg-card2 text-ink-dim`}>
          <span className="w-2 h-2 rounded-full bg-ink-dim/40" />
          Not supported
        </span>
      )
    case 'misconfigured':
      return (
        <span className={`${labelClass} border-warn/40 bg-warn/10 text-warn`}>
          <span className="w-2 h-2 rounded-full bg-warn" />
          Server misconfigured
        </span>
      )
  }
}

/**
 * botpanel service worker — Web Push handler.
 *
 * Scope: served from `/sw.js` at the site root so it controls every
 * page on the origin. The PushOptIn component registers it on demand
 * (first time the user clicks "Enable notifications") rather than
 * eagerly at page load, so no SW is installed for users who never
 * opt in.
 *
 * Two events:
 *   - `push`              — render a notification from the JSON payload
 *                            the panel sent via web-push.
 *   - `notificationclick` — focus an existing panel tab if one's open,
 *                            otherwise open `data.url` in a new one.
 *
 * Payload contract (must match `src/lib/push/dispatch.ts`):
 *   { title: string, body: string, url: string }
 */

self.addEventListener('install', () => {
  // Skip waiting so a fresh deploy's worker takes over immediately
  // instead of waiting for every panel tab to close. Notifications
  // are a "needs the latest code" surface — the cost of a brief
  // mid-flight version mismatch is much smaller than the cost of an
  // operator never seeing the new payload format.
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  // Claim all currently-open tabs so the new worker handles their
  // push events too — without this, an existing tab keeps talking to
  // the previous worker until next refresh.
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  /** @type {{ title: string; body: string; url: string } | null} */
  let payload = null
  try {
    if (event.data) {
      payload = event.data.json()
    }
  } catch {
    // Bad JSON — fall through to defaults below so the user still
    // sees *something* rather than the push being silently dropped.
  }

  const title = (payload && typeof payload.title === 'string' && payload.title) || 'Botpanel'
  const body = (payload && typeof payload.body === 'string' && payload.body) || 'You have a new notification.'
  const url = (payload && typeof payload.url === 'string' && payload.url) || '/'

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/favicon.ico',
      badge: '/favicon.ico',
      // Pass the URL through so the click handler below can open the
      // right page. `data` is the canonical place for app-defined
      // payload state.
      data: { url },
      // Same-tag collapsing: a flurry of approvals doesn't stack five
      // identical pings — the latest replaces older ones. Tag by URL
      // so an approval and a report stay distinguishable.
      tag: `botpanel:${url}`,
      renotify: true,
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const target =
    (event.notification.data && typeof event.notification.data.url === 'string'
      ? event.notification.data.url
      : '/')

  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      })
      // Prefer an existing panel tab — focus it and navigate it to
      // the right page rather than spawning a third copy. The
      // origin check is defensive; matchAll on this SW already
      // scopes to our origin.
      for (const client of all) {
        try {
          const u = new URL(client.url)
          if (u.origin === self.location.origin) {
            await client.focus()
            if ('navigate' in client && typeof client.navigate === 'function') {
              try {
                await client.navigate(target)
              } catch {
                // navigate can reject on cross-origin or COOP-isolated
                // tabs; the focus above is still useful.
              }
            }
            return
          }
        } catch {
          // Skip clients with un-parseable URLs.
        }
      }
      await self.clients.openWindow(target)
    })(),
  )
})

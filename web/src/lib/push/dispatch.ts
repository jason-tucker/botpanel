/**
 * Web Push dispatcher — the panel-side fan-out for browser notifications.
 *
 * `notifyAll(title, body, url)` reads every row of `push_subscriptions`,
 * fires a `webpush.sendNotification()` to each endpoint with the
 * `{title, body, url}` payload our service worker (`web/public/sw.js`)
 * expects, and prunes any 404 / 410 Gone rows on the spot — those are
 * the push service telling us the endpoint is permanently dead.
 *
 * INVARIANT: this helper is BEST-EFFORT. Callers wrap it in `void
 * notifyAll(...)` (fire-and-forget) so a push outage NEVER fails the
 * underlying DB insert that triggered it — staff approval + report
 * filing must succeed even if the push service is down, the operator
 * forgot to set VAPID keys, or every subscriber has stale endpoints.
 *
 * The dispatcher is lazy at the `web-push` import level — we only
 * `await import('web-push')` inside `notifyAll`, never at module
 * load. That keeps the Edge-runtime build from trying to bundle a
 * Node-only package, and keeps cold-start cost off of pages that
 * never trigger a push.
 */
import { sql, eq, inArray } from 'drizzle-orm'
import { squishyDb } from '../db/squishy'
import { pushSubscriptions } from '../db/schema/panel/pushSubscriptions'
import { env } from '../env'

let _tableEnsured = false

/**
 * Create the push_subscriptions table if it isn't there yet. Runs
 * once per process and is idempotent (IF NOT EXISTS). Matches
 * `web/src/lib/db/migrations/0001_push_subscriptions.sql`
 * exactly — keep them in lockstep when adding columns.
 *
 * Lazy create means a fresh deploy works without a manual psql
 * step; the migration file is still the canonical artifact for
 * operators who prefer to run it themselves.
 */
export async function ensurePushSubscriptionsTable(): Promise<void> {
  if (_tableEnsured) return
  try {
    await squishyDb.execute(sql`
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        user_id        text                       NOT NULL,
        endpoint       text                       NOT NULL,
        p256dh_key     text                       NOT NULL,
        auth_key       text                       NOT NULL,
        subscribed_at  timestamptz                NOT NULL DEFAULT now(),
        last_seen_at   timestamptz                NOT NULL DEFAULT now()
      );
    `)
    await squishyDb.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS push_subscriptions_endpoint_unique
        ON push_subscriptions (endpoint);
    `)
    await squishyDb.execute(sql`
      CREATE INDEX IF NOT EXISTS push_subscriptions_user_id_idx
        ON push_subscriptions (user_id);
    `)
    _tableEnsured = true
  } catch (err) {
    // Best-effort. If the operator's DB user can't CREATE TABLE we
    // log once and let the next query error surface clearly.
    console.warn('[push] ensurePushSubscriptionsTable failed (non-fatal)', err)
  }
}

type PushPayload = {
  title: string
  body: string
  url: string
}

function vapidConfigured(): boolean {
  return Boolean(env.VAPID_PUBLIC && env.VAPID_PRIVATE)
}

/**
 * Fan out a Web Push notification to every registered subscription.
 *
 * Errors and dead endpoints are absorbed:
 *   - HTTP 404 / 410 from the push service → row deleted (permanent
 *     subscription death; the user uninstalled the SW or revoked
 *     permission).
 *   - Any other error → logged, row left intact (transient: push
 *     service hiccup, network blip).
 *
 * Never throws. The return value is the number of successful sends
 * (handy for the caller to log; not required to act on).
 */
export async function notifyAll(
  title: string,
  body: string,
  url: string,
): Promise<number> {
  if (!vapidConfigured()) {
    // Don't spam the log on every report — debug level. The README
    // documents that VAPID is opt-in.
    console.info('[push] notifyAll skipped: VAPID keys not configured')
    return 0
  }

  await ensurePushSubscriptionsTable()

  // Lazy import so Node-only `web-push` never enters the Edge bundle.
  let webpush: typeof import('web-push')
  try {
    webpush = await import('web-push')
  } catch (err) {
    console.warn('[push] web-push import failed (non-fatal)', err)
    return 0
  }

  webpush.setVapidDetails(
    env.VAPID_SUBJECT,
    env.VAPID_PUBLIC!,
    env.VAPID_PRIVATE!,
  )

  let rows: Array<{
    endpoint: string
    p256dhKey: string
    authKey: string
  }>
  try {
    rows = await squishyDb
      .select({
        endpoint: pushSubscriptions.endpoint,
        p256dhKey: pushSubscriptions.p256dhKey,
        authKey: pushSubscriptions.authKey,
      })
      .from(pushSubscriptions)
  } catch (err) {
    console.warn('[push] subscription scan failed (non-fatal)', err)
    return 0
  }

  if (rows.length === 0) return 0

  const payload: PushPayload = { title, body, url }
  const payloadJson = JSON.stringify(payload)

  const deadEndpoints: string[] = []
  const liveEndpoints: string[] = []

  await Promise.allSettled(
    rows.map(async (r) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: r.endpoint,
            keys: { p256dh: r.p256dhKey, auth: r.authKey },
          },
          payloadJson,
          {
            // 12-hour TTL — the push service will hold the message
            // for up to this long for an offline device. Operators
            // refreshing /sudo two days later don't need a stale
            // approval ping.
            TTL: 60 * 60 * 12,
          },
        )
        liveEndpoints.push(r.endpoint)
      } catch (err) {
        const e = err as { statusCode?: number; body?: unknown }
        const status = e?.statusCode
        if (status === 404 || status === 410) {
          // 404 = endpoint never existed (corrupt row); 410 = endpoint
          // permanently gone. Both mean DELETE the row.
          deadEndpoints.push(r.endpoint)
        } else {
          console.warn('[push] send failed (transient)', {
            endpoint: r.endpoint.slice(0, 60) + '…',
            status,
          })
        }
      }
    }),
  )

  // Prune dead endpoints first (one statement). Best-effort —
  // failing to delete just means we retry next time and the next
  // 410 prunes again.
  if (deadEndpoints.length > 0) {
    try {
      await squishyDb
        .delete(pushSubscriptions)
        .where(inArray(pushSubscriptions.endpoint, deadEndpoints))
      console.info('[push] pruned dead endpoints', { count: deadEndpoints.length })
    } catch (err) {
      console.warn('[push] dead-endpoint prune failed (non-fatal)', err)
    }
  }

  // Bump last_seen_at for live ones so an operator inspecting the
  // table can tell which rows are actually receiving.
  if (liveEndpoints.length > 0) {
    try {
      await squishyDb
        .update(pushSubscriptions)
        .set({ lastSeenAt: new Date() })
        .where(inArray(pushSubscriptions.endpoint, liveEndpoints))
    } catch (err) {
      console.warn('[push] last_seen_at update failed (non-fatal)', err)
    }
  }

  return liveEndpoints.length
}

/**
 * Delete a single subscription by endpoint. Used by the
 * DELETE /api/push/subscribe route. Returns whether a row was
 * actually deleted (for the audit row).
 */
export async function deleteSubscriptionByEndpoint(endpoint: string): Promise<boolean> {
  await ensurePushSubscriptionsTable()
  try {
    const deleted = await squishyDb
      .delete(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, endpoint))
      .returning({ endpoint: pushSubscriptions.endpoint })
    return deleted.length > 0
  } catch (err) {
    console.warn('[push] deleteSubscriptionByEndpoint failed', err)
    return false
  }
}

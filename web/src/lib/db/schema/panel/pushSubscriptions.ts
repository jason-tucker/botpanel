/**
 * Panel-owned `push_subscriptions` table — Web Push endpoint registry.
 *
 * UNLIKE the rest of `src/lib/db/schema/` (which is vendored from the
 * bot repos via `scripts/sync-schema.sh` and overwritten on every CI
 * sync), this file is panel-owned. It is NOT touched by the sync
 * script — that script targets `{squishy,otter}/` only. Operators
 * apply the matching CREATE TABLE via the SQL in
 * `src/lib/db/migrations/0001_push_subscriptions.sql`, AND the panel
 * also self-heals via `ensurePushSubscriptionsTable()` (lazy
 * IF NOT EXISTS) so a fresh deploy works without a manual psql step.
 *
 * The table lives in the Squishy Postgres (same DB the panel already
 * uses for `sudo_users`, `staff_approvals`, `report_log`). Putting it
 * there instead of standing up a third DB keeps the deploy story to
 * "one squishy DB + one otter DB" and lets the dispatcher join against
 * existing rows if we ever want per-user filtering.
 */
import {
  pgTable,
  text,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    // Discord snowflake of the subscriber. Multiple endpoints per user
    // are allowed (laptop + phone), so this is NOT a primary key on its
    // own — the (user_id, endpoint) pair is unique via the index below.
    userId: text('user_id').notNull(),

    // The push service endpoint URL the browser handed us. Globally
    // unique by the spec; we mark it unique so a re-subscribe from the
    // same browser upserts cleanly rather than duplicating.
    endpoint: text('endpoint').notNull(),

    // The two halves of the subscription's encryption key, base64url-
    // encoded exactly as the browser gives them to us. `p256dh` is the
    // ECDH public key (~88 chars); `auth` is the 16-byte auth secret
    // (~24 chars). Together with the endpoint they form a complete
    // PushSubscription that web-push.sendNotification() can use.
    p256dhKey: text('p256dh_key').notNull(),
    authKey: text('auth_key').notNull(),

    // First-saw timestamp; immutable across re-subscribes via
    // `onConflictDoUpdate` (we only refresh `lastSeenAt` on upsert).
    subscribedAt: timestamp('subscribed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),

    // Bumped on every successful push send so an operator can spot
    // dead endpoints in the table. Not load-bearing — we rely on
    // HTTP 410 Gone from the push service for the actual delete.
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    // Endpoint is globally unique per the Web Push spec — enforcing
    // it lets us upsert on it without worrying about
    // (user_id, endpoint) collisions across rebinds.
    endpointUniqueIdx: uniqueIndex('push_subscriptions_endpoint_unique')
      .on(t.endpoint),
    // The dispatcher scans by user_id for "send to all of user X's
    // devices" later (V2). For V1 it scans the whole table, so this
    // is forward-looking.
    userIdIdx: index('push_subscriptions_user_id_idx').on(t.userId),
  }),
)

export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect
export type NewPushSubscriptionRow = typeof pushSubscriptions.$inferInsert

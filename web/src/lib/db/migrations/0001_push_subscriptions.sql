-- 0001_push_subscriptions.sql — panel-owned Web Push subscription registry.
--
-- This migration is applied either:
--   (a) manually on the squishy Postgres by the operator:
--         psql "$SQUISHY_DATABASE_URL" -f web/src/lib/db/migrations/0001_push_subscriptions.sql
--   (b) lazily at runtime via `ensurePushSubscriptionsTable()` (called
--       from `src/lib/push/dispatch.ts` and the subscribe routes). The
--       runtime path uses IF NOT EXISTS, so re-running this file
--       afterward is a safe no-op.
--
-- We sit on the squishy DB because the panel already uses it for
-- panel-owned reads/writes (`sudo_users`, `staff_approvals`), and
-- standing up a third Postgres just for this one table is a
-- disproportionate ops cost. The bot itself never touches this table.

CREATE TABLE IF NOT EXISTS push_subscriptions (
  user_id        text                       NOT NULL,
  endpoint       text                       NOT NULL,
  p256dh_key     text                       NOT NULL,
  auth_key       text                       NOT NULL,
  subscribed_at  timestamptz                NOT NULL DEFAULT now(),
  last_seen_at   timestamptz                NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS push_subscriptions_endpoint_unique
  ON push_subscriptions (endpoint);

CREATE INDEX IF NOT EXISTS push_subscriptions_user_id_idx
  ON push_subscriptions (user_id);

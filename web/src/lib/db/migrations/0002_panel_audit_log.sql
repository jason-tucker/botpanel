-- 0002_panel_audit_log.sql — panel-owned durable audit for Squishy-side panel events.
--
-- Every `writeAudit({ bot: 'squishy', ... })` that is not a successful
-- setting change (sudo edits, push, color roles, auth.login / logout /
-- logout_all, View-As, failed setting attempts, ...) lands here. Successful
-- setting changes still go to the bot's `setting_changes`. Otter events
-- already have `audit_logs`, so there is no `bot` column.
--
-- Applied either:
--   (a) manually on the squishy Postgres by the operator:
--         psql "$SQUISHY_DATABASE_URL" -f web/src/lib/db/migrations/0002_panel_audit_log.sql
--   (b) lazily at runtime via `ensurePanelAuditTable()` in
--       `src/lib/db/panelAudit.ts` (IF NOT EXISTS, so re-running is a no-op).
-- Keep the statements below in lockstep with that function.
--
-- No retention purge yet (low volume).

CREATE TABLE IF NOT EXISTS panel_audit_log (
  id               bigserial    PRIMARY KEY,
  created_at       timestamptz  NOT NULL DEFAULT now(),
  action           text         NOT NULL,
  actor_user_id    text         NOT NULL,
  actor_name       text,
  viewing_user_id  text,
  target_type      text,
  target_id        text,
  success          boolean      NOT NULL,
  error_message    text,
  before           jsonb,
  after            jsonb,
  ip_hash          text,
  ua_hash          text
);

CREATE INDEX IF NOT EXISTS panel_audit_log_created_at_idx
  ON panel_audit_log (created_at DESC);

CREATE INDEX IF NOT EXISTS panel_audit_log_actor_idx
  ON panel_audit_log (actor_user_id);

-- V3-3: AEAD encryption columns for the panel `panel_sessions` table.
--
-- Botpanel historically didn't own any DB tables; bot schemas are vendored
-- via `scripts/sync-schema.sh` and migrations live in the bot repos. This
-- is the first panel-owned table — `panel_sessions` holds per-login state,
-- starting with the AES-256-GCM-encrypted Discord OAuth refresh token.
--
-- Apply this against whichever DB hosts the panel's tables (today the
-- squishy DB, reusing the `squishyDb` Drizzle client). Botpanel still
-- does NOT run `drizzle-kit generate` / `db:migrate` (per CLAUDE.md);
-- the operator applies this file by hand at deploy time:
--
--   psql "$SQUISHY_DATABASE_URL" -f web/src/lib/db/migrations/0001_panel_sessions_aead.sql
--
-- Idempotent so re-running is safe.
--
-- See follow-up PR for: (a) backfilling any rows that ever got plaintext
-- refresh tokens written, (b) dropping the legacy `refresh_token` column.
-- Neither is required at V3-3 because no plaintext rows exist yet.

CREATE TABLE IF NOT EXISTS panel_sessions (
  id                            text PRIMARY KEY,
  user_id                       text NOT NULL,
  refresh_token_ciphertext      bytea,
  refresh_token_iv              bytea,
  refresh_token_tag             bytea,
  refresh_token_key_version     smallint,
  -- Legacy plaintext column. Nullable on purpose: existing rows (none today
  -- in production, but the column exists for parity with the design plan)
  -- are read until the backfill PR rewrites them into the encrypted columns
  -- and drops this column entirely.
  refresh_token                 text,
  created_at                    timestamp NOT NULL DEFAULT now(),
  last_refresh_at               timestamp
);

-- If the table already existed (e.g. from a pre-V3-3 hand-rolled rollout),
-- bring it up to schema by adding any missing columns.
ALTER TABLE panel_sessions
  ADD COLUMN IF NOT EXISTS refresh_token_ciphertext  bytea,
  ADD COLUMN IF NOT EXISTS refresh_token_iv          bytea,
  ADD COLUMN IF NOT EXISTS refresh_token_tag         bytea,
  ADD COLUMN IF NOT EXISTS refresh_token_key_version smallint;

-- `user_id` lookups (used by future "list my sessions" UI and by
-- `logout-all` for the actor-row exclusion) need an index even at the
-- tiny scale we expect. Cheap to keep, no penalty if unused.
CREATE INDEX IF NOT EXISTS idx_panel_sessions_user_id
  ON panel_sessions (user_id);

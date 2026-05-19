/**
 * Panel-owned `sessions` table — stores per-login server-side state that
 * can't fit (or shouldn't fit) into the JWT cookie. Today that's just the
 * encrypted Discord OAuth refresh token; future rows may carry device
 * fingerprints, last-seen timestamps, etc.
 *
 * NOT auto-generated. Unlike `schema/squishy/` and `schema/otter/`, this
 * file is hand-authored and lives under the panel's own namespace. Botpanel
 * historically didn't own any DB schemas (`scripts/sync-schema.sh` vendors
 * bot schemas), so this is the first table the panel owns end-to-end.
 *
 * Encryption columns (see `src/lib/auth/tokenCrypto.ts`):
 *   - `refresh_token_ciphertext` — AES-256-GCM ciphertext
 *   - `refresh_token_iv` — 12-byte nonce, per-row random
 *   - `refresh_token_tag` — 16-byte GCM auth tag
 *   - `refresh_token_key_version` — which env key produced the row
 *
 * `refresh_token` (plaintext) is kept temporarily so a future backfill
 * migration can read existing rows, encrypt, and null it out. New writes
 * MUST go to the encrypted columns. The plaintext column drops in the
 * follow-up PR once backfill is complete (out of scope for V3-3).
 */
import {
  pgTable,
  text,
  customType,
  timestamp,
  smallint,
} from 'drizzle-orm/pg-core'

// Drizzle 0.45 ships `bytea` only in some dialects; declare a tiny custom
// type so it round-trips Buffers cleanly with `postgres-js`.
const bytea = customType<{ data: Buffer; default: false }>({
  dataType: () => 'bytea',
})

export const sessions = pgTable('panel_sessions', {
  // 24-byte hex token id (server-side). The JWT cookie carries this as
  // its `jti` claim so we can mark / revoke individual sessions without
  // touching the cookie itself.
  id: text('id').primaryKey(),
  // Discord user id. Indexed implicitly via the (userId, issuedAt) lookups
  // we'll add when the read path lands; for V3-3 we only do whole-table
  // truncate-except-actor, which seqscan is fine for.
  userId: text('user_id').notNull(),
  // ─── Encrypted refresh token (AES-256-GCM) ────────────────────────
  refreshTokenCiphertext: bytea('refresh_token_ciphertext'),
  refreshTokenIv: bytea('refresh_token_iv'),
  refreshTokenTag: bytea('refresh_token_tag'),
  refreshTokenKeyVersion: smallint('refresh_token_key_version'),
  // ─── Legacy plaintext (nullable, dropped post-backfill) ──────────
  // No existing panel deploy actually populated this column — refresh
  // tokens weren't persisted before V3-3 — but we keep it shaped for
  // symmetry with the migration plan in #203 and to give the backfill
  // PR a single, clean column to null out.
  refreshTokenPlaintext: text('refresh_token'),
  // ─── Bookkeeping ─────────────────────────────────────────────────
  createdAt: timestamp('created_at').notNull().defaultNow(),
  // Last time the access token was refreshed via this session. Null on
  // a brand-new row.
  lastRefreshAt: timestamp('last_refresh_at'),
})

export type Session = typeof sessions.$inferSelect
export type NewSession = typeof sessions.$inferInsert

/**
 * Lazy create for the panel-owned `panel_sessions` table (Squishy Postgres).
 *
 * `getSession()` and the OAuth callback both need this table whenever
 * SQUISHY_DATABASE_URL is set: without it every login is refused and every
 * session reads as logged out. So, like `push_subscriptions`
 * (src/lib/push/dispatch.ts) and `panel_audit_log` (./panelAudit.ts), it is
 * created on first use.
 *
 * Matches `web/src/lib/db/migrations/0001_panel_sessions_aead.sql` exactly
 * (CREATE TABLE, ADD COLUMN IF NOT EXISTS, index) — keep them in lockstep.
 *
 * Adding columns needs an ACCESS EXCLUSIVE lock on the table even when every
 * column already exists, and a waiting request for that lock queues every
 * session lookup behind it. So the DDL is skipped when the catalog already
 * shows the table, the four AEAD columns and the index, and otherwise runs
 * in one transaction with a 1 s lock_timeout (5 s statement_timeout): if
 * something else holds the table (pg_dump, an open psql transaction) the
 * attempt fails fast and is retried a minute later instead of blocking.
 */
import { eq, sql } from 'drizzle-orm'
import { squishyDb } from './squishy'
import { sessions } from './schema/panel'

const RETRY_MS = 60_000

let _ensured = false
let _running: Promise<void> | null = null
let _lastAttemptAt = 0

/**
 * Is everything the DDL below would create already there (table, the four
 * AEAD columns, the index)? Catalog reads only, so no lock on the table;
 * to_regclass resolves through search_path like the DDL does.
 */
async function alreadyInPlace(): Promise<boolean> {
  const result = await squishyDb.execute(sql`
    SELECT (
      to_regclass('panel_sessions') IS NOT NULL
      AND to_regclass('idx_panel_sessions_user_id') IS NOT NULL
      AND (
        SELECT count(*) FROM pg_attribute
        WHERE attrelid = to_regclass('panel_sessions')
          AND attnum > 0
          AND NOT attisdropped
          AND attname IN ('refresh_token_ciphertext', 'refresh_token_iv',
                          'refresh_token_tag', 'refresh_token_key_version')
      ) = 4
    ) AS ok
  `)
  const rows = (result as unknown as { rows?: unknown[] }).rows ?? (result as unknown as unknown[])
  const first = Array.isArray(rows) ? (rows[0] as { ok?: unknown } | undefined) : undefined
  return first?.ok === true
}

async function runDdl(): Promise<void> {
  if (await alreadyInPlace()) return
  await squishyDb.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL lock_timeout = '1s'`)
    await tx.execute(sql`SET LOCAL statement_timeout = '5s'`)
    await tx.execute(sql`
      CREATE TABLE IF NOT EXISTS panel_sessions (
        id                            text PRIMARY KEY,
        user_id                       text NOT NULL,
        refresh_token_ciphertext      bytea,
        refresh_token_iv              bytea,
        refresh_token_tag             bytea,
        refresh_token_key_version     smallint,
        refresh_token                 text,
        created_at                    timestamp NOT NULL DEFAULT now(),
        last_refresh_at               timestamp
      );
    `)
    await tx.execute(sql`
      ALTER TABLE panel_sessions
        ADD COLUMN IF NOT EXISTS refresh_token_ciphertext  bytea,
        ADD COLUMN IF NOT EXISTS refresh_token_iv          bytea,
        ADD COLUMN IF NOT EXISTS refresh_token_tag         bytea,
        ADD COLUMN IF NOT EXISTS refresh_token_key_version smallint;
    `)
    await tx.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_panel_sessions_user_id
        ON panel_sessions (user_id);
    `)
  })
}

/**
 * Create `panel_sessions` if it isn't there yet. Never throws. Once per
 * process on success; concurrent callers share one attempt; after a failure
 * (no CREATE privilege, lock timeout) the next attempt waits at least a
 * minute, and the lookups and inserts still run against whatever is there.
 */
export function ensurePanelSessionsTable(): Promise<void> {
  if (_ensured) return Promise.resolve()
  if (_running) return _running
  if (_lastAttemptAt && Date.now() - _lastAttemptAt < RETRY_MS) return Promise.resolve()
  _lastAttemptAt = Date.now()
  _running = runDdl()
    .then(() => {
      _ensured = true
    })
    .catch((err) => {
      console.warn('[session] ensurePanelSessionsTable failed (non-fatal; retry in 60 s):', dbErrorText(err))
    })
    .finally(() => {
      _running = null
    })
  return _running
}

/**
 * A DB error for logs: the driver / server message and SQLSTATE only.
 * Drizzle's own message embeds the query and its params (session ids,
 * encrypted tokens), so never log the error object itself.
 */
export function dbErrorText(err: unknown): string {
  const inner = err instanceof Error && err.cause instanceof Error ? err.cause : err
  if (!(inner instanceof Error)) return 'unknown error'
  const code = (inner as { code?: unknown }).code
  return typeof code === 'string' ? `${code} ${inner.message}` : inner.message
}

/** Caller-side cap on the logout row delete. */
export const SESSION_DELETE_BUDGET_MS = 1_000

export type BoundedResult<T> = { ok: true; value: T } | { ok: false; reason: 'failed' | 'timeout'; error?: unknown }

/**
 * Wait for `work` at most `budgetMs`. Never throws; the timer is always
 * cleared. A late rejection of an abandoned `work` is swallowed.
 */
export async function runBounded<T>(work: Promise<T>, budgetMs: number): Promise<BoundedResult<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<BoundedResult<T>>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, reason: 'timeout' }), budgetMs)
  })
  try {
    return await Promise.race([
      work.then(
        (value): BoundedResult<T> => ({ ok: true, value }),
        (error): BoundedResult<T> => ({ ok: false, reason: 'failed', error }),
      ),
      timeout,
    ])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Delete one `panel_sessions` row without ever hanging the caller: the DB
 * side gives up after 800 ms (lock_timeout / statement_timeout, SET LOCAL
 * inside a transaction), the caller after `budgetMs`. Never throws.
 */
export async function deleteSessionRowBounded(
  jti: string,
  budgetMs: number = SESSION_DELETE_BUDGET_MS,
): Promise<BoundedResult<void>> {
  return runBounded(
    squishyDb.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL lock_timeout = '800ms'`)
      await tx.execute(sql`SET LOCAL statement_timeout = '800ms'`)
      await tx.delete(sessions).where(eq(sessions.id, jti))
    }),
    budgetMs,
  )
}

/** Delay before the one background retry of a failed logout row delete. */
export const SESSION_DELETE_RETRY_MS = 5_000

/**
 * Fire-and-forget: try `deleteSessionRowBounded` once more after `delayMs`.
 * Never throws and never rejects; the outcome is only logged (via
 * `dbErrorText`, never the raw error, whose message carries the jti).
 */
export function retrySessionRowDeleteLater(jti: string, delayMs: number = SESSION_DELETE_RETRY_MS): void {
  const timer = setTimeout(() => {
    // Inside .then so a synchronous throw (e.g. no DB client) lands in .catch.
    Promise.resolve()
      .then(() => deleteSessionRowBounded(jti))
      .then((r) => {
        if (r.ok) {
          console.warn('[auth.logout] session row delete retry succeeded')
        } else {
          console.warn(
            '[auth.logout] session row delete retry',
            r.reason === 'timeout' ? 'timed out' : `failed: ${dbErrorText(r.error)}`,
            '(row left; this process still treats the session as revoked)',
          )
        }
      })
      .catch((err: unknown) => {
        console.warn('[auth.logout] session row delete retry could not start:', dbErrorText(err))
      })
  }, delayMs)
  // Don't keep the process alive just for this.
  ;(timer as { unref?: () => void }).unref?.()
}

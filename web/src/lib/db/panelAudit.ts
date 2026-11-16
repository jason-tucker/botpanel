/**
 * Writer for the panel-owned `panel_audit_log` table (Squishy Postgres).
 *
 * Best-effort, like the rest of the audit path (see src/lib/audit.ts):
 * `insertPanelAudit` never throws. It returns false when the row could not
 * be written so the caller can leave its console breadcrumb instead.
 */
import { sql } from 'drizzle-orm'
import { squishyDb } from './squishy'
import { panelAuditLog } from './schema/panel/panelAuditLog'
import { dbErrorText } from './panelSessions'
import { env } from '../env'
import type { PanelAuditRowInput } from '../panelAuditRow'

const ENSURE_RETRY_MS = 60_000

let _tableEnsured = false
let _lastEnsureAttemptAt = 0

/**
 * Create `panel_audit_log` if it isn't there yet. Once per process on
 * success; after a failure the DDL is retried at most once a minute, not on
 * every write.
 * Matches `web/src/lib/db/migrations/0002_panel_audit_log.sql` exactly —
 * keep them in lockstep when adding columns.
 *
 * Index creation locks the table against writes even when the index exists,
 * so the DDL is skipped when the catalog already shows the table and both
 * indexes, and otherwise runs in one transaction with a 1 s lock_timeout
 * (5 s statement_timeout) so a concurrent lock holder fails it fast.
 */
export async function ensurePanelAuditTable(): Promise<void> {
  if (_tableEnsured) return
  if (_lastEnsureAttemptAt && Date.now() - _lastEnsureAttemptAt < ENSURE_RETRY_MS) return
  _lastEnsureAttemptAt = Date.now()
  try {
    const result = await squishyDb.execute(sql`
      SELECT (
        to_regclass('panel_audit_log') IS NOT NULL
        AND to_regclass('panel_audit_log_created_at_idx') IS NOT NULL
        AND to_regclass('panel_audit_log_actor_idx') IS NOT NULL
      ) AS ok
    `)
    const rows = (result as unknown as { rows?: unknown[] }).rows ?? (result as unknown as unknown[])
    const first = Array.isArray(rows) ? (rows[0] as { ok?: unknown } | undefined) : undefined
    if (first?.ok === true) {
      _tableEnsured = true
      return
    }
    await squishyDb.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL lock_timeout = '1s'`)
      await tx.execute(sql`SET LOCAL statement_timeout = '5s'`)
      await tx.execute(sql`
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
      `)
      await tx.execute(sql`
        CREATE INDEX IF NOT EXISTS panel_audit_log_created_at_idx
          ON panel_audit_log (created_at DESC);
      `)
      await tx.execute(sql`
        CREATE INDEX IF NOT EXISTS panel_audit_log_actor_idx
          ON panel_audit_log (actor_user_id);
      `)
    })
    _tableEnsured = true
  } catch (err) {
    // The DB user may lack CREATE, or a lock holder made the DDL time out,
    // while the table already exists — the insert below still gets its chance.
    console.warn('[audit] ensurePanelAuditTable failed (non-fatal):', dbErrorText(err))
  }
}

/** Insert one row. Never throws; false when the row was not written. */
export async function insertPanelAudit(row: PanelAuditRowInput): Promise<boolean> {
  if (!env.SQUISHY_DATABASE_URL) return false
  try {
    await ensurePanelAuditTable()
    await squishyDb.insert(panelAuditLog).values(row)
    return true
  } catch (err) {
    console.warn('[audit] panel_audit_log insert failed (non-fatal)', err)
    return false
  }
}

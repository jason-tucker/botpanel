/**
 * Unified audit-write helper used by every write-side route in the
 * dashboard. Maps a single canonical event shape onto whichever bot's
 * audit table is appropriate (Squishy → `setting_changes` for settings
 * edits, Otter → `audit_logs` for everything else).
 *
 * Invariants:
 *  - Audit is BEST-EFFORT. A failing insert MUST NOT prevent the
 *    underlying write from succeeding — the write is the source of
 *    truth; audit is forensics. We wrap inserts in try/catch and
 *    log to console.warn so the operator can spot a misconfigured
 *    audit DB without users seeing 500s.
 *  - Every row records BOTH `actor` (the real user) AND `viewing`
 *    (the impersonated user under View-As; equal to actor otherwise)
 *    so accountability survives impersonation. The squishy schema
 *    only has a single `changed_by_user_id` column, so we encode
 *    `<actor>:via:<viewing>` when they differ; the otter `details`
 *    JSON has room for both as structured fields.
 *  - `source: 'web'` / `via: 'web'` is stamped onto every row we
 *    write so the unified `/audit` tail can distinguish dashboard
 *    edits from in-bot slash-command edits later. Squishy's
 *    `setting_changes` doesn't have a column for it (vendored
 *    schema), so it goes into the `changed_by_user_id` encoding
 *    plus a console.info breadcrumb for now — schema-sync V2 will
 *    land a typed `source` column and this helper switches over.
 */
import { settingChanges } from './db/schema/squishy/settingChanges'
import { auditLogs } from './db/schema/otter/auditLogs'

export type AuditActor = { id: string; username?: string }

export type AuditEvent = {
  bot: 'squishy' | 'otter'
  actor: AuditActor
  viewing: AuditActor
  action: string
  targetType?: string | null
  targetId?: string | null
  before?: unknown
  after?: unknown
  success: boolean
  errorMessage?: string | null
  ipHash?: string | null
  uaHash?: string | null
}

function encodeChangedBy(actor: AuditActor, viewing: AuditActor): string {
  // When View-As is off, just the actor's ID — keeps existing rows
  // (which never include impersonation context) shape-compatible.
  if (actor.id === viewing.id) return actor.id
  // View-As: `<actorId>:via:<viewingId>` — searchable + parseable.
  return `${actor.id}:via:${viewing.id}`
}

function stringify(v: unknown): string | null {
  if (v === undefined || v === null) return null
  if (typeof v === 'string') return v
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

/**
 * True when the action targets Squishy's `bot_settings` table — those
 * land in `setting_changes` for backwards compatibility with the
 * existing audit tail. Everything else (sudo edits, etc.) falls
 * through to a console-only breadcrumb until schema-sync ships
 * Squishy a generic audit_logs table.
 */
function isSquishySettingAction(action: string): boolean {
  return action === 'setting.changed' || action === 'setting.cleared'
}

async function writeSquishyAudit(p: AuditEvent): Promise<void> {
  // Settings actions map cleanly onto the existing setting_changes
  // table. The `targetId` carries the setting key.
  if (isSquishySettingAction(p.action)) {
    try {
      const { squishyDb } = await import('./db/squishy')
      await squishyDb.insert(settingChanges).values({
        key: p.targetId ?? 'unknown',
        oldValue: stringify(p.before),
        newValue: stringify(p.after),
        changedByUserId: encodeChangedBy(p.actor, p.viewing),
      })
      console.info('[audit] squishy setting_changes', {
        key: p.targetId,
        actor: p.actor.id,
        viewing: p.viewing.id,
        via: 'web',
        success: p.success,
      })
    } catch (err) {
      console.warn('[audit] squishy insert failed (non-fatal)', err)
    }
    return
  }

  // Non-settings squishy actions (e.g. sudo_user.added) don't have a
  // typed audit table in the vendored schema yet — log a structured
  // breadcrumb to console.info so the operator can grep for it.
  // Schema-sync V2 will land a generic squishy.audit_logs and this
  // branch switches to a Drizzle insert just like otter below.
  console.info('[audit] squishy (no-table)', {
    action: p.action,
    targetType: p.targetType,
    targetId: p.targetId,
    actor: p.actor.id,
    viewing: p.viewing.id,
    via: 'web',
    success: p.success,
    errorMessage: p.errorMessage,
    ipHash: p.ipHash,
    uaHash: p.uaHash,
  })
}

async function writeOtterAudit(p: AuditEvent): Promise<void> {
  try {
    const { otterDb } = await import('./db/otter')
    // Otter's audit_logs has dedicated columns for actor + business +
    // target; impersonation context, before/after snapshots, and
    // forensic hashes ride in the JSONB `details` column.
    const businessId = p.targetType === 'business' ? p.targetId ?? null : null
    const details: Record<string, unknown> = {
      via: 'web',
      viewing: p.viewing.id === p.actor.id ? null : p.viewing.id,
    }
    if (p.before !== undefined) details.before = p.before
    if (p.after !== undefined) details.after = p.after
    if (p.errorMessage) details.error = p.errorMessage
    if (p.ipHash) details.ipHash = p.ipHash
    if (p.uaHash) details.uaHash = p.uaHash

    await otterDb.insert(auditLogs).values({
      actorDiscordId: p.actor.id,
      actorName: p.actor.username ?? p.actor.id,
      businessId,
      action: p.action,
      targetType: p.targetType ?? null,
      targetId: p.targetId ?? null,
      details,
      success: p.success,
    })
  } catch (err) {
    console.warn('[audit] otter insert failed (non-fatal)', err)
  }
}

export async function writeAudit(p: AuditEvent): Promise<void> {
  // Whole helper is best-effort. We already try/catch inside each
  // per-bot writer but a defensive outer guard makes absolutely sure
  // a thrown async error from somewhere unexpected can never crash
  // a caller mid-write.
  try {
    if (p.bot === 'squishy') {
      await writeSquishyAudit(p)
    } else {
      await writeOtterAudit(p)
    }
  } catch (err) {
    console.warn('[audit] writeAudit unexpected failure (non-fatal)', err)
  }
}

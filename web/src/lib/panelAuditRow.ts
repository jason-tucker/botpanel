/**
 * Pure mapping between the canonical `writeAudit` event and a
 * `panel_audit_log` row (and from a stored row to an `<AuditTable>` row).
 *
 * Zero runtime imports on purpose: scratch checks run this file directly
 * with `node --experimental-strip-types`, which only erases types. Keep it
 * free of enums, namespaces and parameter properties.
 */
import type { AuditTableRow } from '@/components/AuditTable'

/** Max serialised size of a `before` / `after` value (characters of JSON). */
export const MAX_JSON_CHARS = 8 * 1024
/** Max length of a stored error message. */
export const MAX_ERROR_CHARS = 1000
/** Chars of the original JSON kept when a value is too large. */
const PREVIEW_CHARS = 2000

/** Structural subset of `AuditEvent` (src/lib/audit.ts) this mapper reads. */
export type PanelAuditInput = {
  actor: { id: string; username?: string }
  viewing: { id: string; username?: string }
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

/** Insert shape; keys match the Drizzle `panelAuditLog` table. */
export type PanelAuditRowInput = {
  action: string
  actorUserId: string
  actorName: string | null
  viewingUserId: string | null
  targetType: string | null
  targetId: string | null
  success: boolean
  errorMessage: string | null
  before: unknown
  after: unknown
  ipHash: string | null
  uaHash: string | null
}

/**
 * Make a value safe for a `jsonb` column: plain JSON only, bounded size.
 * - undefined / null -> null
 * - not serialisable (circular, BigInt) -> String(v)
 * - serialised JSON over MAX_JSON_CHARS -> { truncated: true, preview }
 */
export function clampJson(v: unknown): unknown {
  if (v === undefined || v === null) return null
  let s: string | undefined
  try {
    s = JSON.stringify(v)
  } catch {
    return String(v)
  }
  // Functions / symbols serialise to undefined.
  if (s === undefined) return null
  if (s.length > MAX_JSON_CHARS) {
    return { truncated: true, preview: s.slice(0, PREVIEW_CHARS) }
  }
  return JSON.parse(s) as unknown
}

function clampText(v: string | null | undefined, max: number): string | null {
  if (v === undefined || v === null) return null
  return v.length > max ? v.slice(0, max) : v
}

export function toPanelAuditRow(p: PanelAuditInput): PanelAuditRowInput {
  return {
    action: p.action,
    actorUserId: p.actor.id,
    actorName: p.actor.username ?? null,
    // NULL when View-As is off, so "via" only shows for real impersonation.
    viewingUserId: p.viewing.id === p.actor.id ? null : p.viewing.id,
    targetType: p.targetType ?? null,
    targetId: p.targetId ?? null,
    success: p.success,
    errorMessage: clampText(p.errorMessage, MAX_ERROR_CHARS),
    before: clampJson(p.before),
    after: clampJson(p.after),
    ipHash: p.ipHash ?? null,
    uaHash: p.uaHash ?? null,
  }
}

/** Stored-row subset the audit page selects. */
export type PanelAuditStoredRow = {
  id: number | string
  createdAt: Date
  action: string
  actorUserId: string
  viewingUserId: string | null
  success: boolean
  errorMessage: string | null
  before: unknown
  after: unknown
}

export function panelAuditToTableRow(r: PanelAuditStoredRow): AuditTableRow {
  return {
    id: String(r.id),
    changedAt: r.createdAt,
    action: r.action,
    actorUserId: r.actorUserId,
    viewingUserId: r.viewingUserId,
    source: 'web',
    success: r.success,
    errorMessage: r.errorMessage,
    before: r.before,
    after: r.after,
  }
}

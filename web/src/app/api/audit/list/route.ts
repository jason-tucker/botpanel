/**
 * GET /api/audit/list — initial snapshot for the unified audit tail.
 *
 * Pulls the last N rows from BOTH bots' audit streams, normalizes them to a
 * unified shape, and returns them as a single array sorted newest-first:
 *   - Squishy: `setting_changes` (every successful setSetting / clearSetting)
 *   - Otter:   `audit_logs` (every staff-side write hits this table)
 *
 * The live tail at `/api/audit/stream` emits the SAME shape over SSE so the
 * client can append rows without reconciling two row schemas.
 *
 * Failure mode: if either DB is down (or `*_DATABASE_URL` isn't set), we
 * degrade per-bot instead of 500ing — the response still 200s with the
 * partial result and a per-source `errors[]` entry. The /audit page is
 * meant to be glanceable; a half-empty table beats a stack trace.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { desc } from 'drizzle-orm'
import { withAuth } from '@/lib/auth/middleware'
import { squishyDb } from '@/lib/db/squishy'
import { otterDb } from '@/lib/db/otter'
import { settingChanges } from '@/lib/db/schema/squishy/settingChanges'
import { auditLogs } from '@/lib/db/schema/otter/auditLogs'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_LIMIT = 200
const DEFAULT_LIMIT = 50

export type UnifiedEntry = {
  bot: 'squishy' | 'otter'
  id: string
  ts: string
  actor: string
  action: string
  summary: string
  raw: Record<string, unknown>
}

type BotFilter = 'all' | 'squishy' | 'otter'

function parseLimit(raw: string | null): number {
  if (!raw) return DEFAULT_LIMIT
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT
  return Math.min(Math.floor(n), MAX_LIMIT)
}

function parseBot(raw: string | null): BotFilter {
  if (raw === 'squishy' || raw === 'otter') return raw
  return 'all'
}

function squishySummary(row: {
  key: string
  oldValue: string | null
  newValue: string | null
}): string {
  const parts = [`key=${row.key}`]
  // Truncate values so a giant JSON blob doesn't blow up the row.
  const fmt = (v: string | null): string => {
    if (v == null) return '∅'
    return v.length > 80 ? `${v.slice(0, 80)}…` : v
  }
  parts.push(`old=${fmt(row.oldValue)}`)
  parts.push(`new=${fmt(row.newValue)}`)
  return parts.join('  ')
}

function otterSummary(row: {
  businessId: string | null
  targetType: string | null
  targetId: string | null
  success: boolean
}): string {
  const parts: string[] = []
  if (row.businessId) parts.push(`biz=${row.businessId}`)
  if (row.targetType || row.targetId) {
    parts.push(`target=${row.targetType ?? '?'}/${row.targetId ?? '?'}`)
  }
  parts.push(`success=${row.success}`)
  return parts.join('  ')
}

async function loadSquishy(limit: number): Promise<UnifiedEntry[]> {
  const rows = await squishyDb
    .select()
    .from(settingChanges)
    .orderBy(desc(settingChanges.changedAt))
    .limit(limit)

  return rows.map((r): UnifiedEntry => ({
    bot: 'squishy',
    id: r.id,
    ts: r.changedAt.toISOString(),
    actor: r.changedByUserId ?? 'unknown',
    action: 'setting.changed',
    summary: squishySummary({
      key: r.key,
      oldValue: r.oldValue,
      newValue: r.newValue,
    }),
    raw: {
      id: r.id,
      key: r.key,
      oldValue: r.oldValue,
      newValue: r.newValue,
      changedByUserId: r.changedByUserId,
      changedAt: r.changedAt.toISOString(),
    },
  }))
}

async function loadOtter(limit: number): Promise<UnifiedEntry[]> {
  const rows = await otterDb
    .select()
    .from(auditLogs)
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit)

  return rows.map((r): UnifiedEntry => ({
    bot: 'otter',
    id: r.id,
    ts: r.createdAt.toISOString(),
    actor: r.actorDiscordId,
    action: r.action,
    summary: otterSummary({
      businessId: r.businessId,
      targetType: r.targetType,
      targetId: r.targetId,
      success: r.success,
    }),
    raw: {
      id: r.id,
      actorDiscordId: r.actorDiscordId,
      actorName: r.actorName,
      businessId: r.businessId,
      action: r.action,
      targetType: r.targetType,
      targetId: r.targetId,
      details: r.details,
      success: r.success,
      createdAt: r.createdAt.toISOString(),
    },
  }))
}

export const GET = withAuth(
  async (req: NextRequest) => {
    const url = new URL(req.url)
    const limit = parseLimit(url.searchParams.get('limit'))
    const bot = parseBot(url.searchParams.get('bot'))

    const errors: string[] = []
    const entries: UnifiedEntry[] = []

    const tasks: Array<Promise<void>> = []
    if (bot === 'all' || bot === 'squishy') {
      tasks.push(
        loadSquishy(limit)
          .then((rows) => { entries.push(...rows) })
          .catch((err: unknown) => {
            console.warn('[audit/list] squishy load failed', err)
            errors.push('squishy unavailable')
          }),
      )
    }
    if (bot === 'all' || bot === 'otter') {
      tasks.push(
        loadOtter(limit)
          .then((rows) => { entries.push(...rows) })
          .catch((err: unknown) => {
            console.warn('[audit/list] otter load failed', err)
            errors.push('otter unavailable')
          }),
      )
    }

    await Promise.all(tasks)

    // Newest-first, then trim to the requested limit so a bot dominating the
    // recent window doesn't squeeze the other out beyond the unified cap.
    entries.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0))
    const trimmed = entries.slice(0, limit)

    return NextResponse.json({ entries: trimmed, errors })
  },
  { require: 'sudo' },
)

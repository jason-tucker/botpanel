/**
 * /squishy/audit — full audit log for Squishy's `setting_changes` table.
 *
 * Sudo-only (matches the existing /audit unified tail's gate — Squishy's
 * setting_changes is global, not per-guild, so we don't have a finer
 * scope to grant non-sudo viewers). The /sudo/debug page already shows
 * the last 20 rows as an at-a-glance card; this page is the drill-down
 * with pagination + filtering, sharing Wave 7d-C's <AuditTable>
 * component with the otter per-business view.
 *
 * Note: `setting_changes.changed_by_user_id` is a `text` column that
 * encodes View-As as `<actorId>:via:<viewingId>` (see writeAudit in
 * `web/src/lib/audit.ts`). We split it here so the table's actor /
 * viewing columns line up with the otter shape.
 *
 * `setting_changes` doesn't carry an explicit `success` column today —
 * the table only logs successful writes (failed inserts return early
 * upstream). So we hard-code `success: true` and `source: 'web'`
 * (today the dashboard is the only writer). When schema-sync V2 lands
 * a typed `success` + `source` on squishy audit, this mapping
 * automatically gains the new fidelity.
 *
 * DB call wrapped in try/catch — Squishy Postgres unreachable degrades
 * to "audit unavailable" instead of 500-ing.
 *
 * Next 15: `searchParams` is a Promise.
 */
import { redirect } from 'next/navigation'
import { and, desc, ilike, sql, type SQL } from 'drizzle-orm'
import { getSession } from '@/lib/auth/session'
import { resolveAccess } from '@/lib/auth/perms'
import { squishyDb } from '@/lib/db/squishy'
import { settingChanges } from '@/lib/db/schema/squishy/settingChanges'
import { AuditTable, type AuditTableRow } from '@/components/AuditTable'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 50

type RawSettingChangeRow = {
  id: string
  key: string
  oldValue: string | null
  newValue: string | null
  changedByUserId: string | null
  changedAt: Date
}

type LoadResult =
  | { ok: true; rows: RawSettingChangeRow[]; total: number; actionOptions: string[] }
  | { ok: false }

/**
 * Try to parse `setting_changes.old_value` / `new_value`. Squishy stores
 * them as plain `text`, but our audit writer JSON-encodes structured
 * values via `stringify()` (see `lib/audit.ts`). Try JSON.parse first,
 * fall through to the literal string if it isn't valid JSON.
 */
function parseValue(v: string | null): unknown {
  if (v === null) return null
  try {
    return JSON.parse(v)
  } catch {
    return v
  }
}

/**
 * Pull apart the encoded `<actorId>:via:<viewingId>` form. When the
 * column is just an actor id, viewing is null (and the table cell hides
 * the "via" line). The schema lets the column be null — older rows
 * predate the auth helper — so we surface those as a synthetic
 * "unknown" actor.
 */
function splitActor(raw: string | null): { actor: string; viewing: string | null } {
  if (!raw) return { actor: 'unknown', viewing: null }
  const sep = raw.indexOf(':via:')
  if (sep < 0) return { actor: raw, viewing: null }
  return { actor: raw.slice(0, sep), viewing: raw.slice(sep + ':via:'.length) }
}

/**
 * Synthesize an `action` string for the AuditTable from the
 * setting-change row. `setting.changed` when the value was edited (old
 * + new both present), `setting.cleared` when new is null, and
 * `setting.set` when old is null — matches the canonical action names
 * written by `lib/audit.ts`.
 */
function deriveAction(r: RawSettingChangeRow): string {
  if (r.newValue === null) return 'setting.cleared'
  if (r.oldValue === null) return 'setting.set'
  return 'setting.changed'
}

async function loadAudit(
  page: number,
  filters: { action: string | null; actor: string | null; success: 'true' | 'false' | null },
): Promise<LoadResult> {
  try {
    const clauses: SQL[] = []
    if (filters.action) clauses.push(ilike(settingChanges.key, `%${filters.action}%`))
    if (filters.actor) {
      // The text column may be either `<actor>` or `<actor>:via:<viewing>`,
      // so a substring match on the actor is the right semantic.
      clauses.push(ilike(settingChanges.changedByUserId, `${filters.actor}%`))
    }
    // No `success` column today — when filter is 'false', return zero
    // rows; when 'true', no extra clause needed (every row is implicitly
    // a success). Encoded by an always-false sentinel.
    if (filters.success === 'false') {
      clauses.push(sql`1 = 0`)
    }
    const whereExpr =
      clauses.length === 0 ? undefined : clauses.length === 1 ? clauses[0] : and(...clauses)

    const baseQuery = squishyDb
      .select({
        id: settingChanges.id,
        key: settingChanges.key,
        oldValue: settingChanges.oldValue,
        newValue: settingChanges.newValue,
        changedByUserId: settingChanges.changedByUserId,
        changedAt: settingChanges.changedAt,
      })
      .from(settingChanges)

    const countBase = squishyDb
      .select({ n: sql<number>`count(*)::int` })
      .from(settingChanges)

    const distinctBase = squishyDb
      .selectDistinct({ key: settingChanges.key })
      .from(settingChanges)
      .orderBy(settingChanges.key)
      .limit(50)

    const [rows, countRows, distinctActions] = await Promise.all([
      whereExpr
        ? baseQuery
            .where(whereExpr)
            .orderBy(desc(settingChanges.changedAt))
            .limit(PAGE_SIZE)
            .offset((page - 1) * PAGE_SIZE)
        : baseQuery
            .orderBy(desc(settingChanges.changedAt))
            .limit(PAGE_SIZE)
            .offset((page - 1) * PAGE_SIZE),
      whereExpr ? countBase.where(whereExpr) : countBase,
      distinctBase,
    ])

    const total = Number(countRows[0]?.n ?? 0)
    const actionOptions = distinctActions.map((r) => r.key).filter(Boolean)
    return { ok: true, rows, total, actionOptions }
  } catch (err) {
    console.warn('[squishy/audit] audit load failed', err)
    return { ok: false }
  }
}

function mapRow(r: RawSettingChangeRow): AuditTableRow {
  const { actor, viewing } = splitActor(r.changedByUserId)
  return {
    id: r.id,
    changedAt: r.changedAt,
    action: deriveAction(r),
    actorUserId: actor,
    viewingUserId: viewing,
    source: 'web',
    success: true,
    errorMessage: null,
    before: { key: r.key, value: parseValue(r.oldValue) },
    after: { key: r.key, value: parseValue(r.newValue) },
  }
}

export default async function SquishyAuditPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string
    action?: string
    actor?: string
    success?: string
  }>
}) {
  const session = await getSession()
  if (!session) redirect('/api/auth/login')

  const access = await resolveAccess(session)
  const canView = access.botOwner || access.squishy.sudo

  if (!canView) {
    return (
      <main className="min-h-dvh p-6 sm:p-10">
        <div className="max-w-md mx-auto rounded-2xl border border-line bg-bg-card p-6 flex flex-col gap-3">
          <h1 className="text-xl font-semibold">403 — Not allowed</h1>
          <p className="text-ink-dim text-sm">
            The Squishy audit log is sudo-only. If you think you should
            have access, ask the bot owner to add your Discord ID to{' '}
            <code className="font-mono text-xs">SUDO_USER_IDS</code> or
            the <code className="font-mono text-xs">sudo_users</code>{' '}
            table.
          </p>
        </div>
      </main>
    )
  }

  const sp = await searchParams
  const rawPage = Number(sp.page ?? '1')
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1
  const actionFilter = (sp.action ?? '').trim() || null
  const actorFilter = (sp.actor ?? '').trim() || null
  const successRaw = sp.success
  const successFilter: 'true' | 'false' | null =
    successRaw === 'true' || successRaw === 'false' ? successRaw : null

  const result = await loadAudit(page, {
    action: actionFilter,
    actor: actorFilter,
    success: successFilter,
  })

  const pathname = '/squishy/audit'
  const passThrough: Record<string, string | undefined> = {
    action: actionFilter ?? undefined,
    actor: actorFilter ?? undefined,
    success: successFilter ?? undefined,
  }

  return (
    <main className="min-h-dvh p-6 sm:p-10 pt-16 md:pt-10">
      <div className="max-w-6xl mx-auto flex flex-col gap-6">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">Squishy audit log</h1>
          <p className="text-sm text-ink-dim">
            Every successful <code className="font-mono text-xs">bot_settings</code> edit,
            paginated 50/page. For the live cross-bot feed see the{' '}
            <a className="text-accent underline" href="/audit">
              Audit tail
            </a>
            .
          </p>
        </header>

        {!result.ok ? (
          <div className="rounded-xl border border-line bg-bg-card p-6 text-sm text-ink-dim italic">
            Audit data is currently unavailable.
          </div>
        ) : (
          <AuditTable
            rows={result.rows.map(mapRow)}
            page={page}
            pageSize={PAGE_SIZE}
            total={result.total}
            pathname={pathname}
            searchParams={passThrough}
            bot="squishy"
            filters={{
              action: actionFilter ?? undefined,
              actor: actorFilter ?? undefined,
              success: successFilter ?? 'all',
            }}
            actionOptions={result.actionOptions}
          />
        )}
      </div>
    </main>
  )
}

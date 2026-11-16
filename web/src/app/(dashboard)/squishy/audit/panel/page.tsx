/**
 * /squishy/audit/panel — the panel-owned `panel_audit_log` (Squishy DB):
 * every Squishy-side panel event that is not a successful setting change
 * (sudo, push, color roles, auth login / logout / logout-all, View-As,
 * failed setting attempts, ...). Successful setting changes stay on
 * /squishy/audit (`setting_changes`).
 *
 * Gate: bot owner or Squishy sudo, same as /squishy/audit. 50 rows/page;
 * filters: action (exact), actor (id prefix), success (real column).
 * DB failure (including the table not existing yet) degrades to an
 * "unavailable" card instead of a 500.
 *
 * Next 15: `searchParams` is a Promise.
 */
import { redirect } from 'next/navigation'
import { and, desc, eq, like, sql, type SQL } from 'drizzle-orm'
import { getSession } from '@/lib/auth/session'
import { resolveAccess } from '@/lib/auth/perms'
import { squishyDb } from '@/lib/db/squishy'
import { panelAuditLog } from '@/lib/db/schema/panel/panelAuditLog'
import { panelAuditToTableRow, type PanelAuditStoredRow } from '@/lib/panelAuditRow'
import { AuditTable } from '@/components/AuditTable'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 50

type LoadResult =
  | { ok: true; rows: PanelAuditStoredRow[]; total: number; actionOptions: string[] }
  | { ok: false }

/** Escape LIKE wildcards so the actor filter is a literal prefix. */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`)
}

async function loadPanelAudit(
  page: number,
  filters: { action: string | null; actor: string | null; success: 'true' | 'false' | null },
): Promise<LoadResult> {
  try {
    const clauses: SQL[] = []
    if (filters.action) clauses.push(eq(panelAuditLog.action, filters.action))
    if (filters.actor) clauses.push(like(panelAuditLog.actorUserId, `${escapeLike(filters.actor)}%`))
    if (filters.success) clauses.push(eq(panelAuditLog.success, filters.success === 'true'))
    const whereExpr = clauses.length === 0 ? undefined : and(...clauses)

    const [rows, countRows, distinctActions] = await Promise.all([
      squishyDb
        .select({
          id: panelAuditLog.id,
          createdAt: panelAuditLog.createdAt,
          action: panelAuditLog.action,
          actorUserId: panelAuditLog.actorUserId,
          viewingUserId: panelAuditLog.viewingUserId,
          success: panelAuditLog.success,
          errorMessage: panelAuditLog.errorMessage,
          before: panelAuditLog.before,
          after: panelAuditLog.after,
        })
        .from(panelAuditLog)
        .where(whereExpr)
        .orderBy(desc(panelAuditLog.createdAt), desc(panelAuditLog.id))
        .limit(PAGE_SIZE)
        .offset((page - 1) * PAGE_SIZE),
      squishyDb
        .select({ n: sql<number>`count(*)::int` })
        .from(panelAuditLog)
        .where(whereExpr),
      squishyDb
        .selectDistinct({ action: panelAuditLog.action })
        .from(panelAuditLog)
        .orderBy(panelAuditLog.action)
        .limit(50),
    ])

    return {
      ok: true,
      rows,
      total: Number(countRows[0]?.n ?? 0),
      actionOptions: distinctActions.map((r) => r.action).filter(Boolean),
    }
  } catch (err) {
    console.warn('[squishy/audit/panel] audit load failed', err)
    return { ok: false }
  }
}

export default async function SquishyPanelAuditPage({
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
            The panel audit log is sudo-only. If you think you should
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

  const result = await loadPanelAudit(page, {
    action: actionFilter,
    actor: actorFilter,
    success: successFilter,
  })

  const passThrough: Record<string, string | undefined> = {
    action: actionFilter ?? undefined,
    actor: actorFilter ?? undefined,
    success: successFilter ?? undefined,
  }

  return (
    <main className="min-h-dvh p-6 sm:p-10 pt-16 md:pt-10">
      <div className="max-w-6xl mx-auto flex flex-col gap-6">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">Squishy panel events</h1>
          <p className="text-sm text-ink-dim">
            Panel actions other than successful setting edits (sudo, push,
            roles, sign-ins, View-As, failed attempts), paginated 50/page.
            Setting edits are on the{' '}
            <a className="text-accent underline" href="/squishy/audit">
              Squishy audit log
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
            rows={result.rows.map(panelAuditToTableRow)}
            page={page}
            pageSize={PAGE_SIZE}
            total={result.total}
            pathname="/squishy/audit/panel"
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

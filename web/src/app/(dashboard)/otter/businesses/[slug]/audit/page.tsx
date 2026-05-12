/**
 * /otter/businesses/[slug]/audit — full audit log for one business.
 *
 * Same access gate as the per-business detail page (bot owner OR any rank
 * in this business). The detail page itself lets any rank see the last 20
 * audit rows, so this drill-down inherits that gate — staff who can see
 * the per-business detail can also see its full audit. Future tightening
 * (manager-only) would be a per-row visibility flag, not a page gate.
 *
 * Note: `audit_logs.businessId` is `text`, not `uuid` — see
 * `web/src/lib/db/schema/otter/auditLogs.ts`. We compare against
 * `businesses.id::text` via the Drizzle column directly; Drizzle coerces
 * the bound param to text.
 *
 * Pagination via `?page=N` (size 50). Filters via `?action=…`, `?actor=…`,
 * `?success=true|false`. DB call wrapped in try/catch — Otter Postgres
 * unreachable degrades to "audit unavailable" instead of 500-ing.
 *
 * Wave 7d-C: the row-rendering surface itself now comes from the shared
 * `<AuditTable>` component. This page is only responsible for the DB
 * query + access gate + business header; chips, table, and pagination
 * live in `<AuditTable>` so squishy + otter render identically.
 *
 * Next 15: `params` + `searchParams` are Promises.
 */
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { and, eq, desc, ilike, sql, type SQL } from 'drizzle-orm'
import { getSession } from '@/lib/auth/session'
import { resolveAccess } from '@/lib/auth/perms'
import { otterDb } from '@/lib/db/otter'
import { businesses } from '@/lib/db/schema/otter/businesses'
import { auditLogs } from '@/lib/db/schema/otter/auditLogs'
import { AuditTable, type AuditTableRow } from '@/components/AuditTable'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 50

type BusinessRow = {
  id: string
  name: string
  slug: string
}

type RawAuditRow = {
  id: string
  actorDiscordId: string
  actorName: string | null
  action: string
  targetType: string | null
  targetId: string | null
  success: boolean
  details: Record<string, unknown> | null
  createdAt: Date
}

type LoadResult =
  | { ok: true; rows: RawAuditRow[]; total: number; actionOptions: string[] }
  | { ok: false }

async function loadBusiness(slug: string): Promise<BusinessRow | null> {
  try {
    const rows = await otterDb
      .select({
        id: businesses.id,
        name: businesses.name,
        slug: businesses.slug,
      })
      .from(businesses)
      .where(eq(businesses.slug, slug))
      .limit(1)
    return rows[0] ?? null
  } catch (err) {
    console.warn('[otter/businesses/:slug/audit] business load failed', err)
    return null
  }
}

async function loadAudit(
  businessId: string,
  page: number,
  filters: { action: string | null; actor: string | null; success: 'true' | 'false' | null },
): Promise<LoadResult> {
  try {
    const clauses: SQL[] = [eq(auditLogs.businessId, businessId)]
    if (filters.action) clauses.push(ilike(auditLogs.action, `%${filters.action}%`))
    if (filters.actor) clauses.push(eq(auditLogs.actorDiscordId, filters.actor))
    if (filters.success === 'true') clauses.push(eq(auditLogs.success, true))
    if (filters.success === 'false') clauses.push(eq(auditLogs.success, false))
    const whereExpr = clauses.length === 1 ? clauses[0] : and(...clauses)

    const [rows, countRows, distinctActions] = await Promise.all([
      otterDb
        .select({
          id: auditLogs.id,
          actorDiscordId: auditLogs.actorDiscordId,
          actorName: auditLogs.actorName,
          action: auditLogs.action,
          targetType: auditLogs.targetType,
          targetId: auditLogs.targetId,
          success: auditLogs.success,
          details: auditLogs.details,
          createdAt: auditLogs.createdAt,
        })
        .from(auditLogs)
        .where(whereExpr)
        .orderBy(desc(auditLogs.createdAt))
        .limit(PAGE_SIZE)
        .offset((page - 1) * PAGE_SIZE),
      otterDb
        .select({ n: sql<number>`count(*)::int` })
        .from(auditLogs)
        .where(whereExpr),
      otterDb
        .selectDistinct({ action: auditLogs.action })
        .from(auditLogs)
        .where(eq(auditLogs.businessId, businessId))
        .orderBy(auditLogs.action)
        .limit(50),
    ])

    const total = Number(countRows[0]?.n ?? 0)
    const actionOptions = distinctActions.map((r) => r.action).filter(Boolean)
    return { ok: true, rows, total, actionOptions }
  } catch (err) {
    console.warn('[otter/businesses/:slug/audit] audit load failed', err)
    return { ok: false }
  }
}

function NotFoundCard({ slug }: { slug: string }) {
  return (
    <main className="min-h-dvh p-6 sm:p-10">
      <div className="max-w-md mx-auto rounded-2xl border border-line bg-bg-card p-6 flex flex-col gap-3">
        <h1 className="text-xl font-semibold">404 — Business not found</h1>
        <p className="text-ink-dim text-sm">
          No active or deactivated business with slug{' '}
          <code className="font-mono text-xs">{slug}</code>.
        </p>
        <Link href="/otter/businesses" className="text-sm text-accent underline self-start">
          ← All businesses
        </Link>
      </div>
    </main>
  )
}

function ForbiddenCard({ slug }: { slug: string }) {
  return (
    <main className="min-h-dvh p-6 sm:p-10">
      <div className="max-w-md mx-auto rounded-2xl border border-line bg-bg-card p-6 flex flex-col gap-3">
        <h1 className="text-xl font-semibold">403 — Not allowed</h1>
        <p className="text-ink-dim text-sm">
          You don&apos;t have a rank in{' '}
          <code className="font-mono text-xs">{slug}</code>.
        </p>
        <Link href="/otter/businesses" className="text-sm text-accent underline self-start">
          ← All businesses
        </Link>
      </div>
    </main>
  )
}

/**
 * Map an Otter `audit_logs` row into the shared `AuditTableRow` shape.
 *
 * `details` is JSONB written by `writeAudit()` and carries our
 * `via` / `viewing` / `before` / `after` / `error` fields. We treat
 * anything we don't recognize as opaque and forward it as part of
 * `after` so it still surfaces in the diff column.
 */
function mapRow(r: RawAuditRow): AuditTableRow {
  const d = r.details ?? {}
  const viaRaw = typeof d.via === 'string' ? d.via : 'web'
  const source: 'web' | 'bot' | 'rpc' =
    viaRaw === 'web' || viaRaw === 'bot' || viaRaw === 'rpc' ? viaRaw : 'web'
  const viewing = typeof d.viewing === 'string' ? d.viewing : null
  const before = 'before' in d ? d.before : undefined
  const after = 'after' in d ? d.after : undefined
  const errorMessage = typeof d.error === 'string' ? d.error : null
  return {
    id: r.id,
    changedAt: r.createdAt,
    action: r.action,
    actorUserId: r.actorDiscordId,
    viewingUserId: viewing,
    source,
    success: r.success,
    errorMessage,
    before,
    after,
  }
}

export default async function BusinessAuditPage(
  {
    params,
    searchParams,
  }: {
    params: Promise<{ slug: string }>
    searchParams: Promise<{
      page?: string
      action?: string
      actor?: string
      success?: string
    }>
  },
) {
  const { slug } = await params
  const sp = await searchParams

  const session = await getSession()
  if (!session) redirect('/api/auth/login')

  const access = await resolveAccess(session)
  const explicitRank = access.otter.businesses[slug]
  if (!explicitRank && !access.botOwner) {
    return <ForbiddenCard slug={slug} />
  }

  const biz = await loadBusiness(slug)
  if (!biz) return <NotFoundCard slug={slug} />

  const rawPage = Number(sp.page ?? '1')
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1
  const actionFilter = (sp.action ?? '').trim() || null
  const actorFilter = (sp.actor ?? '').trim() || null
  const successRaw = sp.success
  const successFilter: 'true' | 'false' | null =
    successRaw === 'true' || successRaw === 'false' ? successRaw : null

  const result = await loadAudit(biz.id, page, {
    action: actionFilter,
    actor: actorFilter,
    success: successFilter,
  })

  const pathname = `/otter/businesses/${slug}/audit`
  // Pre-resolve actor display names from the rows themselves —
  // `audit_logs.actor_name` is captured at write-time so we don't
  // need a per-render RPC. <UserChip> from Wave 7d-B will replace this
  // with a real Discord-resolved cache.
  const resolved = new Map<string, { id: string; username?: string | null }>()
  if (result.ok) {
    for (const r of result.rows) {
      if (r.actorName && !resolved.has(r.actorDiscordId)) {
        resolved.set(r.actorDiscordId, {
          id: r.actorDiscordId,
          username: r.actorName,
        })
      }
    }
  }

  // Pass-through searchParams (already string|undefined) to the table for
  // its href-building. Drop `page` since the table owns pagination.
  const passThrough: Record<string, string | undefined> = {
    action: actionFilter ?? undefined,
    actor: actorFilter ?? undefined,
    success: successFilter ?? undefined,
  }

  return (
    <main className="min-h-dvh p-6 sm:p-10">
      <div className="max-w-6xl mx-auto flex flex-col gap-6">
        <header className="flex flex-col gap-3">
          <div className="flex items-center gap-2 text-sm text-ink-dim">
            <Link href="/otter/businesses" className="hover:text-ink">
              All businesses
            </Link>
            <span>/</span>
            <Link href={`/otter/businesses/${slug}`} className="hover:text-ink">
              {biz.name}
            </Link>
            <span>/</span>
            <span className="text-ink">Audit</span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold">Audit log — {biz.name}</h1>
          </div>
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
            bot="otter"
            filters={{
              action: actionFilter ?? undefined,
              actor: actorFilter ?? undefined,
              success: successFilter ?? 'all',
            }}
            resolved={resolved}
            actionOptions={result.actionOptions}
          />
        )}
      </div>
    </main>
  )
}

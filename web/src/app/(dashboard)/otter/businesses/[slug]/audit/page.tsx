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
 * Pagination via `?page=N` (size 50), optional `?action=substring` ILIKE
 * filter on `action`. DB call wrapped in try/catch — Otter Postgres
 * unreachable degrades to "audit unavailable" instead of 500-ing.
 *
 * Next 15: `params` + `searchParams` are Promises.
 */
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { and, eq, desc, ilike, sql } from 'drizzle-orm'
import { getSession } from '@/lib/auth/session'
import { resolveAccess } from '@/lib/auth/perms'
import { otterDb } from '@/lib/db/otter'
import { businesses } from '@/lib/db/schema/otter/businesses'
import { auditLogs } from '@/lib/db/schema/otter/auditLogs'
import { relTime } from '@/lib/util/otterFormat'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 50

type BusinessRow = {
  id: string
  name: string
  slug: string
}

type AuditRow = {
  id: string
  actorDiscordId: string
  actorName: string
  action: string
  targetType: string | null
  targetId: string | null
  success: boolean
  details: Record<string, unknown> | null
  createdAt: Date
}

type LoadResult =
  | { ok: true; rows: AuditRow[]; total: number }
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
  actionFilter: string | null,
): Promise<LoadResult> {
  try {
    const filter = actionFilter
      ? and(
          eq(auditLogs.businessId, businessId),
          ilike(auditLogs.action, `%${actionFilter}%`),
        )
      : eq(auditLogs.businessId, businessId)

    const [rows, countRows] = await Promise.all([
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
        .where(filter)
        .orderBy(desc(auditLogs.createdAt))
        .limit(PAGE_SIZE)
        .offset((page - 1) * PAGE_SIZE),
      otterDb
        .select({ n: sql<number>`count(*)::int` })
        .from(auditLogs)
        .where(filter),
    ])

    const total = Number(countRows[0]?.n ?? 0)
    return { ok: true, rows, total }
  } catch (err) {
    console.warn('[otter/businesses/:slug/audit] audit load failed', err)
    return { ok: false }
  }
}

function pillClass(extra: string): string {
  return `inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${extra}`
}

function pageUrl(slug: string, page: number, action: string | null): string {
  const params = new URLSearchParams()
  if (page !== 1) params.set('page', String(page))
  if (action) params.set('action', action)
  const qs = params.toString()
  return `/otter/businesses/${slug}/audit${qs ? `?${qs}` : ''}`
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

export default async function BusinessAuditPage(
  {
    params,
    searchParams,
  }: {
    params: Promise<{ slug: string }>
    searchParams: Promise<{ page?: string; action?: string }>
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

  const result = await loadAudit(biz.id, page, actionFilter)
  const totalPages = result.ok
    ? Math.max(1, Math.ceil(result.total / PAGE_SIZE))
    : 1

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
            {result.ok && (
              <span className="text-sm text-ink-dim">
                {result.total} total
              </span>
            )}
          </div>
        </header>

        <form
          action={`/otter/businesses/${slug}/audit`}
          method="GET"
          className="flex items-center gap-2"
        >
          <input
            type="text"
            name="action"
            defaultValue={actionFilter ?? ''}
            placeholder="Filter by action…"
            className="flex-1 rounded-lg border border-line bg-bg-card2 px-3 py-2 text-sm text-ink placeholder:text-ink-dim/70 focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <button
            type="submit"
            className="rounded-lg border border-line bg-bg-card2 hover:bg-bg-card2/70 px-3 py-2 text-sm text-ink"
          >
            Filter
          </button>
          {actionFilter && (
            <Link
              href={`/otter/businesses/${slug}/audit`}
              className="rounded-lg border border-line bg-transparent hover:bg-bg-card2/50 px-3 py-2 text-sm text-ink-dim hover:text-ink"
            >
              Clear
            </Link>
          )}
        </form>

        {!result.ok ? (
          <div className="rounded-xl border border-line bg-bg-card p-6 text-sm text-ink-dim italic">
            Audit data is currently unavailable.
          </div>
        ) : result.rows.length === 0 ? (
          <div className="rounded-xl border border-line bg-bg-card p-6 text-sm text-ink-dim">
            {actionFilter ? 'No matches.' : 'No audit entries for this business.'}
          </div>
        ) : (
          <div className="rounded-xl border border-line bg-bg-card overflow-hidden">
            <ul className="flex flex-col">
              {result.rows.map((a) => (
                <li
                  key={a.id}
                  className="border-b border-line last:border-b-0 px-3 py-2 hover:bg-bg-card2/30"
                >
                  <details className="group">
                    <summary className="flex flex-wrap items-center gap-3 cursor-pointer list-none">
                      <span
                        className={pillClass(
                          a.success
                            ? 'bg-ok/15 text-ok border-ok/30'
                            : 'bg-err/15 text-err border-err/30',
                        )}
                      >
                        {a.success ? '✓' : '✗'}
                      </span>
                      <span className="font-mono text-sm min-w-0 truncate flex-1">
                        {a.action}
                      </span>
                      <span className="text-xs text-ink-dim font-mono whitespace-nowrap">
                        {a.targetType ?? '—'}
                        {a.targetId ? `/${a.targetId}` : ''}
                      </span>
                      <span className="text-xs text-ink-dim font-mono truncate max-w-[14rem]">
                        {a.actorName} · {`<@${a.actorDiscordId}>`}
                      </span>
                      <span
                        className="text-xs text-ink-dim whitespace-nowrap"
                        title={a.createdAt.toISOString()}
                      >
                        {relTime(a.createdAt)}
                      </span>
                    </summary>
                    <pre className="mt-2 text-xs text-ink-dim font-mono whitespace-pre-wrap break-all bg-bg p-2 rounded border border-line">
                      {JSON.stringify(
                        {
                          actorDiscordId: a.actorDiscordId,
                          target: a.targetType
                            ? `${a.targetType}/${a.targetId ?? '?'}`
                            : a.targetId ?? null,
                          details: a.details,
                        },
                        null,
                        2,
                      )}
                    </pre>
                  </details>
                </li>
              ))}
            </ul>
            <nav className="flex items-center justify-between px-3 py-2 border-t border-line bg-bg-card2/40 text-xs text-ink-dim">
              {page > 1 ? (
                <Link href={pageUrl(slug, page - 1, actionFilter)} className="hover:text-ink">
                  ← Prev
                </Link>
              ) : (
                <span className="opacity-50">← Prev</span>
              )}
              <span>
                Page {page} of {totalPages}
              </span>
              {page < totalPages ? (
                <Link href={pageUrl(slug, page + 1, actionFilter)} className="hover:text-ink">
                  Next →
                </Link>
              ) : (
                <span className="opacity-50">Next →</span>
              )}
            </nav>
          </div>
        )}
      </div>
    </main>
  )
}

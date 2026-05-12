/**
 * /otter/businesses/[slug]/standings — full standings table for one business.
 *
 * Drill-down off the per-business detail page. Same access gate as the
 * detail (bot owner OR any rank in this business). Pagination is URL-driven
 * (`?page=N`, size 50) so links stay shareable and there's no client state.
 *
 * Optional `?character=substring` filter does a case-insensitive ILIKE on
 * BOTH `character_id` and `character_name` — staff cite both forms
 * interchangeably (mention vs nickname) and the OR keeps the URL trivial.
 *
 * Schema uses `updated_at` as the freshness column (no `created_at` on this
 * table — see web/src/lib/db/schema/otter/standings.ts), so ordering follows
 * that. DB call is try/catch'd — a downed Otter Postgres degrades the table
 * to "data unavailable" instead of 500-ing the whole page.
 *
 * Next 15: `params` + `searchParams` are Promises.
 */
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { and, eq, desc, or, ilike, sql } from 'drizzle-orm'
import { getSession } from '@/lib/auth/session'
import { resolveAccess } from '@/lib/auth/perms'
import { otterDb } from '@/lib/db/otter'
import { businesses } from '@/lib/db/schema/otter/businesses'
import { standings } from '@/lib/db/schema/otter/standings'
import { standingColor, relTime } from '@/lib/util/otterFormat'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 50

type BusinessRow = {
  id: string
  name: string
  slug: string
}

type StandingRow = {
  id: string
  characterId: string
  characterName: string
  standing: 'good' | 'neutral' | 'bad' | 'blacklisted'
  reason: string | null
  updatedByDiscordId: string
  updatedAt: Date
}

type LoadResult = {
  ok: true
  rows: StandingRow[]
  total: number
} | {
  ok: false
}

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
    console.warn('[otter/businesses/:slug/standings] business load failed', err)
    return null
  }
}

async function loadStandings(
  businessId: string,
  page: number,
  characterFilter: string | null,
): Promise<LoadResult> {
  try {
    const filter = characterFilter
      ? and(
          eq(standings.businessId, businessId),
          or(
            ilike(standings.characterId, `%${characterFilter}%`),
            ilike(standings.characterName, `%${characterFilter}%`),
          ),
        )
      : eq(standings.businessId, businessId)

    const [rows, countRows] = await Promise.all([
      otterDb
        .select({
          id: standings.id,
          characterId: standings.characterId,
          characterName: standings.characterName,
          standing: standings.standing,
          reason: standings.reason,
          updatedByDiscordId: standings.updatedByDiscordId,
          updatedAt: standings.updatedAt,
        })
        .from(standings)
        .where(filter)
        .orderBy(desc(standings.updatedAt))
        .limit(PAGE_SIZE)
        .offset((page - 1) * PAGE_SIZE),
      otterDb
        .select({ n: sql<number>`count(*)::int` })
        .from(standings)
        .where(filter),
    ])

    const total = Number(countRows[0]?.n ?? 0)
    return { ok: true, rows, total }
  } catch (err) {
    console.warn('[otter/businesses/:slug/standings] standings load failed', err)
    return { ok: false }
  }
}

function pillClass(extra: string): string {
  return `inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${extra}`
}

function pageUrl(slug: string, page: number, character: string | null): string {
  const params = new URLSearchParams()
  if (page !== 1) params.set('page', String(page))
  if (character) params.set('character', character)
  const qs = params.toString()
  return `/otter/businesses/${slug}/standings${qs ? `?${qs}` : ''}`
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

export default async function BusinessStandingsPage(
  {
    params,
    searchParams,
  }: {
    params: Promise<{ slug: string }>
    searchParams: Promise<{ page?: string; character?: string }>
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
  const characterFilter = (sp.character ?? '').trim() || null

  const result = await loadStandings(biz.id, page, characterFilter)
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
            <span className="text-ink">Standings</span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold">Standings — {biz.name}</h1>
            {result.ok && (
              <span className="text-sm text-ink-dim">
                {result.total} total
              </span>
            )}
          </div>
        </header>

        <form
          action={`/otter/businesses/${slug}/standings`}
          method="GET"
          className="flex items-center gap-2"
        >
          <input
            type="text"
            name="character"
            defaultValue={characterFilter ?? ''}
            placeholder="Filter by character ID or name…"
            className="flex-1 rounded-lg border border-line bg-bg-card2 px-3 py-2 text-sm text-ink placeholder:text-ink-dim/70 focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <button
            type="submit"
            className="rounded-lg border border-line bg-bg-card2 hover:bg-bg-card2/70 px-3 py-2 text-sm text-ink"
          >
            Filter
          </button>
          {characterFilter && (
            <Link
              href={`/otter/businesses/${slug}/standings`}
              className="rounded-lg border border-line bg-transparent hover:bg-bg-card2/50 px-3 py-2 text-sm text-ink-dim hover:text-ink"
            >
              Clear
            </Link>
          )}
        </form>

        {!result.ok ? (
          <div className="rounded-xl border border-line bg-bg-card p-6 text-sm text-ink-dim italic">
            Standings data is currently unavailable.
          </div>
        ) : result.rows.length === 0 ? (
          <div className="rounded-xl border border-line bg-bg-card p-6 text-sm text-ink-dim">
            {characterFilter ? 'No matches.' : 'No standings recorded.'}
          </div>
        ) : (
          <div className="rounded-xl border border-line bg-bg-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-bg-card2 text-xs uppercase tracking-wider text-ink-dim">
                  <tr>
                    <th className="px-3 py-2 font-medium">Character</th>
                    <th className="px-3 py-2 font-medium">Standing</th>
                    <th className="px-3 py-2 font-medium">Reason</th>
                    <th className="px-3 py-2 font-medium">Set by</th>
                    <th className="px-3 py-2 font-medium">When</th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((s) => (
                    <tr key={s.id} className="border-b border-line last:border-b-0 hover:bg-bg-card2/30 align-top">
                      <td className="px-3 py-2 text-sm">
                        <div className="font-medium">{s.characterName}</div>
                        <div className="font-mono text-xs text-ink-dim">
                          {s.characterId}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <span className={pillClass(standingColor(s.standing))}>
                          {s.standing}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-sm text-ink-dim max-w-md">
                        {s.reason ? (
                          <span className="line-clamp-2">{s.reason}</span>
                        ) : (
                          <span className="italic">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-ink-dim whitespace-nowrap">
                        {s.updatedByDiscordId}
                      </td>
                      <td
                        className="px-3 py-2 text-xs text-ink-dim whitespace-nowrap"
                        title={s.updatedAt.toISOString()}
                      >
                        {relTime(s.updatedAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <nav className="flex items-center justify-between px-3 py-2 border-t border-line bg-bg-card2/40 text-xs text-ink-dim">
              {page > 1 ? (
                <Link
                  href={pageUrl(slug, page - 1, characterFilter)}
                  className="hover:text-ink"
                >
                  ← Prev
                </Link>
              ) : (
                <span className="opacity-50">← Prev</span>
              )}
              <span>
                Page {page} of {totalPages}
              </span>
              {page < totalPages ? (
                <Link
                  href={pageUrl(slug, page + 1, characterFilter)}
                  className="hover:text-ink"
                >
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

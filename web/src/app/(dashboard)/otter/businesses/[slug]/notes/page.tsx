/**
 * /otter/businesses/[slug]/notes — full notes list for one business, with
 * per-row visibility gating applied in the WHERE clause.
 *
 * Visibility ladder (in `web/src/lib/db/schema/otter/notes.ts`):
 *   `staff`   — visible to anyone with a rank in this business (employee+)
 *   `manager` — manager+ only
 *   `owner`   — owner only (bot owner also)
 *
 * We could filter in JS after the SELECT, but pushing the visibility set
 * into SQL means a manager who somehow lands on this page never sees an
 * owner-only note even briefly in the response payload — defense in depth.
 *
 * Optional `?q=substring` ILIKE on `content`. Pagination via `?page=N`
 * (size 50). DB call is try/catch'd — Otter Postgres unreachable degrades
 * to "notes unavailable" rather than 500-ing the page.
 *
 * Next 15: `params` + `searchParams` are Promises.
 */
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { and, eq, desc, ilike, inArray, sql } from 'drizzle-orm'
import { getSession } from '@/lib/auth/session'
import { resolveAccess, type BusinessRank } from '@/lib/auth/perms'
import { otterDb } from '@/lib/db/otter'
import { businesses } from '@/lib/db/schema/otter/businesses'
import { notes } from '@/lib/db/schema/otter/notes'
import { relTime } from '@/lib/util/otterFormat'
import { AddNoteForm, DeleteNoteButton } from './NoteForms'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 50

type NoteVisibility = 'staff' | 'manager' | 'owner'

type BusinessRow = {
  id: string
  name: string
  slug: string
}

type NoteRow = {
  id: string
  characterId: string
  characterName: string
  content: string
  authorDiscordId: string
  authorName: string
  visibility: NoteVisibility
  createdAt: Date
}

type LoadResult =
  | { ok: true; rows: NoteRow[]; total: number }
  | { ok: false }

/**
 * Map a viewer's effective rank (or bot-owner) to the visibility tiers they
 * may see. Bot owner sees everything regardless of rank.
 */
function allowedVisibilities(
  rank: BusinessRank | null,
  botOwner: boolean,
): NoteVisibility[] {
  if (botOwner) return ['staff', 'manager', 'owner']
  if (rank === 'owner') return ['staff', 'manager', 'owner']
  if (rank === 'manager') return ['staff', 'manager']
  if (rank === 'employee') return ['staff']
  return []
}

/**
 * Highest visibility a viewer can AUTHOR at. Mirrors the API gate in
 * `/api/otter/businesses/[slug]/notes/route.ts` so the form select only
 * surfaces tiers the user will actually be allowed to submit.
 */
function maxWritableVisibility(
  rank: BusinessRank | null,
  botOwner: boolean,
): NoteVisibility | null {
  if (botOwner) return 'owner'
  if (rank === 'owner') return 'owner'
  if (rank === 'manager') return 'manager'
  if (rank === 'employee') return 'staff'
  return null
}

const VISIBILITY_LADDER: NoteVisibility[] = ['staff', 'manager', 'owner']

function visibilitiesUpTo(ceiling: NoteVisibility): NoteVisibility[] {
  const idx = VISIBILITY_LADDER.indexOf(ceiling)
  return VISIBILITY_LADDER.slice(0, idx + 1)
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
    console.warn('[otter/businesses/:slug/notes] business load failed', err)
    return null
  }
}

async function loadNotes(
  businessId: string,
  visibilities: NoteVisibility[],
  page: number,
  q: string | null,
): Promise<LoadResult> {
  try {
    const conds = [
      eq(notes.businessId, businessId),
      inArray(notes.visibility, visibilities),
    ]
    if (q) conds.push(ilike(notes.content, `%${q}%`))
    const filter = and(...conds)

    const [rows, countRows] = await Promise.all([
      otterDb
        .select({
          id: notes.id,
          characterId: notes.characterId,
          characterName: notes.characterName,
          content: notes.content,
          authorDiscordId: notes.authorDiscordId,
          authorName: notes.authorName,
          visibility: notes.visibility,
          createdAt: notes.createdAt,
        })
        .from(notes)
        .where(filter)
        .orderBy(desc(notes.createdAt))
        .limit(PAGE_SIZE)
        .offset((page - 1) * PAGE_SIZE),
      otterDb
        .select({ n: sql<number>`count(*)::int` })
        .from(notes)
        .where(filter),
    ])

    const total = Number(countRows[0]?.n ?? 0)
    return { ok: true, rows, total }
  } catch (err) {
    console.warn('[otter/businesses/:slug/notes] notes load failed', err)
    return { ok: false }
  }
}

function pillClass(extra: string): string {
  return `inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${extra}`
}

function visibilityColor(v: NoteVisibility): string {
  switch (v) {
    case 'staff':
      return 'bg-bg-card2 text-ink-dim border-line'
    case 'manager':
      return 'bg-accent/15 text-accent border-accent/30'
    case 'owner':
      return 'bg-warn/15 text-warn border-warn/30'
    default:
      return 'bg-bg-card2 text-ink-dim border-line'
  }
}

function pageUrl(slug: string, page: number, q: string | null): string {
  const params = new URLSearchParams()
  if (page !== 1) params.set('page', String(page))
  if (q) params.set('q', q)
  const qs = params.toString()
  return `/otter/businesses/${slug}/notes${qs ? `?${qs}` : ''}`
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

function NoteCard({
  note,
  slug,
  canDelete,
}: {
  note: NoteRow
  slug: string
  canDelete: boolean
}) {
  const long = note.content.length > 320
  return (
    <li className="rounded-lg border border-line bg-bg-card2 px-4 py-3 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <span className={pillClass(visibilityColor(note.visibility))}>
          {note.visibility}
        </span>
        <div className="flex-1 min-w-0">
          <div className="font-medium truncate">{note.characterName}</div>
          <div className="font-mono text-xs text-ink-dim truncate">
            {note.characterId}
          </div>
        </div>
        <span
          className="text-xs text-ink-dim whitespace-nowrap"
          title={note.createdAt.toISOString()}
        >
          {relTime(note.createdAt)}
        </span>
        {canDelete && <DeleteNoteButton slug={slug} noteId={note.id} />}
      </div>
      <div className="text-xs text-ink-dim font-mono flex flex-wrap items-center gap-2">
        <span>by {note.authorName}</span>
        <span>·</span>
        <span>{note.authorDiscordId}</span>
        <span>·</span>
        <span>{`<@${note.authorDiscordId}>`}</span>
      </div>
      {long ? (
        <details className="group">
          <summary className="text-sm text-ink whitespace-pre-wrap break-words cursor-pointer list-none">
            {note.content.slice(0, 320)}
            <span className="text-ink-dim">… </span>
            <span className="text-accent text-xs underline">
              show full ({note.content.length} chars)
            </span>
          </summary>
          <div className="text-sm text-ink whitespace-pre-wrap break-words mt-2">
            {note.content}
          </div>
        </details>
      ) : (
        <div className="text-sm text-ink whitespace-pre-wrap break-words">
          {note.content}
        </div>
      )}
    </li>
  )
}

export default async function BusinessNotesPage(
  {
    params,
    searchParams,
  }: {
    params: Promise<{ slug: string }>
    searchParams: Promise<{ page?: string; q?: string }>
  },
) {
  const { slug } = await params
  const sp = await searchParams

  const session = await getSession()
  if (!session) redirect('/api/auth/login')

  const access = await resolveAccess(session)
  const explicitRank = access.otter.businesses[slug] ?? null
  if (!explicitRank && !access.botOwner) {
    return <ForbiddenCard slug={slug} />
  }

  const biz = await loadBusiness(slug)
  if (!biz) return <NotFoundCard slug={slug} />

  const visibilities = allowedVisibilities(explicitRank, access.botOwner)
  // Belt-and-suspenders: if somehow no tiers are allowed, surface a 403
  // rather than running a query with an empty IN list (which Drizzle would
  // emit as `IN ()` and Postgres would refuse).
  if (visibilities.length === 0) {
    return <ForbiddenCard slug={slug} />
  }

  const writeCeiling = maxWritableVisibility(explicitRank, access.botOwner)
  const writableVisibilities = writeCeiling
    ? visibilitiesUpTo(writeCeiling)
    : []
  const isBusinessOwner = explicitRank === 'owner'

  const rawPage = Number(sp.page ?? '1')
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1
  const q = (sp.q ?? '').trim() || null

  const result = await loadNotes(biz.id, visibilities, page, q)
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
            <span className="text-ink">Notes</span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold">Notes — {biz.name}</h1>
            {result.ok && (
              <span className="text-sm text-ink-dim">
                {result.total} visible to you
              </span>
            )}
          </div>
          <p className="text-xs text-ink-dim">
            Visibility tiers you can see: {visibilities.join(', ')}.
          </p>
        </header>

        {writableVisibilities.length > 0 && (
          <section className="rounded-xl border border-line bg-bg-card p-4 flex flex-col gap-3">
            <header className="flex items-baseline justify-between gap-3 flex-wrap">
              <h2 className="text-base font-semibold">Add note</h2>
              <p className="text-xs text-ink-dim">
                Authoring is capped at your rank: {writableVisibilities.join(', ')}.
              </p>
            </header>
            <AddNoteForm slug={slug} writableVisibilities={writableVisibilities} />
          </section>
        )}

        <form
          action={`/otter/businesses/${slug}/notes`}
          method="GET"
          className="flex items-center gap-2"
        >
          <input
            type="text"
            name="q"
            defaultValue={q ?? ''}
            placeholder="Search note content…"
            className="flex-1 rounded-lg border border-line bg-bg-card2 px-3 py-2 text-sm text-ink placeholder:text-ink-dim/70 focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <button
            type="submit"
            className="rounded-lg border border-line bg-bg-card2 hover:bg-bg-card2/70 px-3 py-2 text-sm text-ink"
          >
            Search
          </button>
          {q && (
            <Link
              href={`/otter/businesses/${slug}/notes`}
              className="rounded-lg border border-line bg-transparent hover:bg-bg-card2/50 px-3 py-2 text-sm text-ink-dim hover:text-ink"
            >
              Clear
            </Link>
          )}
        </form>

        {!result.ok ? (
          <div className="rounded-xl border border-line bg-bg-card p-6 text-sm text-ink-dim italic">
            Notes data is currently unavailable.
          </div>
        ) : result.rows.length === 0 ? (
          <div className="rounded-xl border border-line bg-bg-card p-6 text-sm text-ink-dim">
            {q ? 'No matches.' : 'No notes recorded.'}
          </div>
        ) : (
          <>
            <ul className="flex flex-col gap-3">
              {result.rows.map((n) => {
                // Mirror the API's gate: bot owner OR business owner OR the
                // note's author (compared against `viewing.id` so the button
                // renders correctly under View-As impersonation).
                const canDelete =
                  access.botOwner ||
                  isBusinessOwner ||
                  n.authorDiscordId === access.viewing.id
                return (
                  <NoteCard
                    key={n.id}
                    note={n}
                    slug={slug}
                    canDelete={canDelete}
                  />
                )
              })}
            </ul>
            <nav className="flex items-center justify-between px-3 py-2 rounded-lg border border-line bg-bg-card2/40 text-xs text-ink-dim">
              {page > 1 ? (
                <Link href={pageUrl(slug, page - 1, q)} className="hover:text-ink">
                  ← Prev
                </Link>
              ) : (
                <span className="opacity-50">← Prev</span>
              )}
              <span>
                Page {page} of {totalPages}
              </span>
              {page < totalPages ? (
                <Link href={pageUrl(slug, page + 1, q)} className="hover:text-ink">
                  Next →
                </Link>
              ) : (
                <span className="opacity-50">Next →</span>
              )}
            </nav>
          </>
        )}
      </div>
    </main>
  )
}

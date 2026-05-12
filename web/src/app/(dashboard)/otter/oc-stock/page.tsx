/**
 * /otter/oc-stock — Original Clothing stock viewer + manager.
 *
 * Mirrors the same `/oc` board that Otterbot renders in Discord. Stock state
 * is shown publicly in-server, so this page is intentionally NOT sudo-gated —
 * any signed-in panel user can see it. (The edge middleware in
 * `web/src/middleware.ts` already bounces un-authed `/otter/*` to `/`, so the
 * only gate here is "have a session"; we re-check inside the component too so
 * a stale build never accidentally renders an authed-only shell to a logged-
 * out viewer.)
 *
 * Edit capability is detected up front via `resolveAccess()`. Owners /
 * managers of the `original-clothing` business (or the bot owner) get the
 * full manage UI (add / edit / delete via `<OcStockManager>` client
 * component). Non-editors get the same read-only card grid they had before.
 *
 * DB-unavailable: every read is try/catch'd so a downed otter Postgres falls
 * back to a friendly "stock not available right now" card instead of 500-ing
 * the whole page. Mutations themselves live in `/api/otter/oc-stock` + its
 * `[id]` route — both return the canonical row shape and `router.refresh()`
 * inside the manager re-renders this server component on success.
 */
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { asc } from 'drizzle-orm'
import { ExternalLink } from 'lucide-react'
import { getSession } from '@/lib/auth/session'
import { resolveAccess } from '@/lib/auth/perms'
import { otterDb } from '@/lib/db/otter'
import { ocStock } from '@/lib/db/schema/otter/ocStock'
import { OcStockManager, type OcStockItem } from './OcStockManager'

export const dynamic = 'force-dynamic'

type OcRow = typeof ocStock.$inferSelect

type LoadResult =
  | { ok: true; rows: OcRow[] }
  | { ok: false; error: 'db-unavailable' }

async function loadStock(): Promise<LoadResult> {
  try {
    const rows = await otterDb
      .select()
      .from(ocStock)
      .orderBy(asc(ocStock.sortOrder), asc(ocStock.name))
    return { ok: true, rows }
  } catch (err) {
    console.warn('[oc-stock] otterDb read failed', err)
    return { ok: false, error: 'db-unavailable' }
  }
}

/**
 * Tiny hand-rolled relative-time formatter. We've avoided pulling a date
 * library elsewhere in the panel (see `AuditLive`) — keep it consistent.
 */
function relTime(d: Date): string {
  const diffMs = Date.now() - d.getTime()
  const sec = Math.round(diffMs / 1000)
  if (sec < 5) return 'just now'
  if (sec < 60) return `${sec}s ago`
  const min = Math.round(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.round(hr / 24)
  if (day < 30) return `${day}d ago`
  const mo = Math.round(day / 30)
  if (mo < 12) return `${mo}mo ago`
  const yr = Math.round(mo / 12)
  return `${yr}y ago`
}

type StatusMeta = {
  emoji: string
  ringClass: string
  cardClass: string
  label: string
}

const STATUS_META: Record<OcRow['status'], StatusMeta> = {
  in_stock: {
    emoji: '🟢',
    ringClass: 'ring-2 ring-emerald-500/60',
    cardClass: '',
    label: 'In stock',
  },
  low_stock: {
    emoji: '🟠',
    ringClass: 'ring-2 ring-orange-500/60',
    cardClass: '',
    label: 'Low stock',
  },
  out_of_stock: {
    emoji: '🔴',
    ringClass: 'ring-2 ring-red-500/60',
    cardClass: 'opacity-50',
    label: 'Out of stock',
  },
}

function ItemCard({ row }: { row: OcRow }) {
  const meta = STATUS_META[row.status] ?? STATUS_META.in_stock
  const updated = row.updatedAt instanceof Date ? row.updatedAt : new Date(row.updatedAt)

  return (
    <div
      className={`rounded-2xl bg-bg-card p-4 flex flex-col gap-3 ${meta.ringClass} ${meta.cardClass}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="text-2xl leading-none" aria-label={meta.label} title={meta.label}>
          {meta.emoji}
        </div>
        <div className="text-[10px] uppercase tracking-wider text-ink-dim">
          {meta.label}
        </div>
      </div>

      <div className="font-semibold text-ink break-words">
        {row.url ? (
          <a
            href={row.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-baseline gap-1 hover:underline"
          >
            <span>{row.name}</span>
            <ExternalLink className="w-3.5 h-3.5 shrink-0 self-center" aria-hidden />
          </a>
        ) : (
          <span>{row.name}</span>
        )}
      </div>

      <div className="mt-auto text-xs text-ink-dim flex flex-col gap-0.5">
        <span title={updated.toISOString()}>Updated {relTime(updated)}</span>
        {row.updatedByDiscordId && (
          <span className="font-mono text-[10px] opacity-70">
            by {row.updatedByDiscordId}
          </span>
        )}
      </div>
    </div>
  )
}

function rowToItem(r: OcRow): OcStockItem {
  return {
    id: r.id,
    name: r.name,
    status: r.status,
    sortOrder: r.sortOrder,
    url: r.url,
    updatedAt: (r.updatedAt instanceof Date ? r.updatedAt : new Date(r.updatedAt)).toISOString(),
    updatedByDiscordId: r.updatedByDiscordId,
  }
}

export default async function OcStockPage() {
  const session = await getSession()
  if (!session) redirect('/')

  const access = await resolveAccess(session)
  const ocRank = access.otter.businesses['original-clothing']
  const canEdit = access.botOwner || ocRank === 'owner' || ocRank === 'manager'

  const result = await loadStock()

  return (
    <main className="min-h-dvh p-6 sm:p-10">
      <div className="max-w-6xl mx-auto flex flex-col gap-6">
        <header className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold">Original Clothing — Stock</h1>
            <p className="text-sm text-ink-dim">
              Public view — Discord users see this via{' '}
              <code className="font-mono text-xs">/oc</code>.
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {canEdit && (
              <span
                className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 px-3 py-2 text-xs uppercase tracking-wider"
                title="You can add, edit and remove stock items below."
              >
                Manage mode
              </span>
            )}
            <Link href="/me" className="text-sm text-ink-dim hover:text-ink">
              ← Dashboard
            </Link>
          </div>
        </header>

        {!result.ok ? (
          <section className="rounded-2xl border border-line bg-bg-card p-6">
            <div className="text-xs uppercase tracking-wider text-ink-dim mb-2">
              Stock unavailable
            </div>
            <p className="text-ink">
              OC stock isn&apos;t available right now — the Otter database is
              unreachable. Try again in a moment. The Discord{' '}
              <code className="font-mono text-xs">/oc</code> command may still
              work if it&apos;s using a cached snapshot.
            </p>
          </section>
        ) : canEdit ? (
          <OcStockManager items={result.rows.map(rowToItem)} canEdit={canEdit} />
        ) : result.rows.length === 0 ? (
          <section className="rounded-2xl border border-line bg-bg-card p-6">
            <div className="text-xs uppercase tracking-wider text-ink-dim mb-2">
              Empty
            </div>
            <p className="text-ink">No items configured yet.</p>
          </section>
        ) : (
          <section className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {result.rows.map((row) => (
              <ItemCard key={row.id} row={row} />
            ))}
          </section>
        )}
      </div>
    </main>
  )
}

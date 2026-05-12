/**
 * `<AuditTable>` — shared audit-row renderer for `/squishy/audit` and
 * `/otter/businesses/[slug]/audit`. Wave 7d-C consolidates the two ad-hoc
 * audit views (`setting_changes` for squishy, `audit_logs` per-business
 * for otter) into a single look and feel. Server component — pages do the
 * DB query, map rows into `AuditTableRow` shape, and pass them in.
 *
 * Renders:
 *   1. Filter chips (Action / Actor / Success-state) — each is a `<Link>`
 *      toggling a query param. Pages pass `searchParams` so we can
 *      preserve other params (e.g. `?action=…&actor=…&page=N`) when
 *      flipping a single chip.
 *   2. A table with columns: `When | Action | Actor | Source | Result |
 *      Diff`. The Diff column is a collapsible `<details>` carrying
 *      before/after as pretty-printed JSON.
 *   3. Pagination footer `← prev · N / M · next →` with disabled-state
 *      links when on the first / last page.
 *
 * UserChip resolution: Wave 7d-B will ship a `<UserChip>` component that
 * the audit table will switch to once it lands. Until then, pages can
 * pre-resolve actor user IDs into the `resolved` Map prop (id → display
 * name + avatar). The column falls back to the raw ID when no resolution
 * is provided. Keeping the prop on the component (not pulling the chip in
 * via dynamic import) means this component remains a pure server
 * component with no client boundary.
 */
import Link from 'next/link'

export type AuditTableUser = {
  id: string
  username?: string | null
  avatar?: string | null
}

export type AuditTableRow = {
  id: string
  changedAt: Date
  action: string
  actorUserId: string
  /** When the actor was acting as someone else (View-As); null when equal to actor. */
  viewingUserId?: string | null
  source: 'web' | 'bot' | 'rpc'
  success: boolean
  errorMessage?: string | null
  before?: unknown
  after?: unknown
}

export type AuditTableFilters = {
  action?: string
  actor?: string
  success?: 'true' | 'false' | 'all'
}

export type AuditTableProps = {
  rows: AuditTableRow[]
  page: number
  pageSize: number
  total: number
  /** Base pathname for pagination + filter-chip links (e.g. `/squishy/audit`). */
  pathname: string
  /** Other live query params to preserve when toggling chips / paginating. */
  searchParams: Record<string, string | undefined>
  /** Which bot we're rendering for — drives any future user-resolution call. */
  bot: 'squishy' | 'otter'
  filters?: AuditTableFilters
  /**
   * Optional pre-resolved user-id → display info. When `<UserChip>` ships
   * (Wave 7d-B) we'll drop this fallback in favor of the chip. Pages
   * pass this in so the table doesn't need its own DB / RPC client.
   */
  resolved?: Map<string, AuditTableUser>
  /**
   * Optional set of distinct action strings to power the "Action" filter
   * chip menu. Pages typically pull this with a `SELECT DISTINCT action`
   * over the unfiltered set; absent means the chip just toggles
   * empty / set state from `filters.action`.
   */
  actionOptions?: string[]
}

const PILL_BASE =
  'inline-flex items-center rounded-full border px-2 py-0.5 text-xs whitespace-nowrap'

function buildHref(
  pathname: string,
  base: Record<string, string | undefined>,
  patch: Record<string, string | null | undefined>,
): string {
  const params = new URLSearchParams()
  const merged: Record<string, string | undefined> = { ...base }
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined || v === '') {
      delete merged[k]
    } else {
      merged[k] = v
    }
  }
  for (const [k, v] of Object.entries(merged)) {
    if (v === undefined || v === null || v === '') continue
    if (k === 'page' && v === '1') continue
    params.set(k, v)
  }
  const qs = params.toString()
  return qs ? `${pathname}?${qs}` : pathname
}

function fmtWhen(d: Date): string {
  // Compact absolute time — the AuditLive client tail renders relative
  // times; the per-page audit views are scanned more like a forensic
  // log, where absolute timestamps win. Title attribute carries ISO so
  // exact precision is hover-away.
  try {
    const yyyy = d.getUTCFullYear()
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
    const dd = String(d.getUTCDate()).padStart(2, '0')
    const hh = String(d.getUTCHours()).padStart(2, '0')
    const mi = String(d.getUTCMinutes()).padStart(2, '0')
    return `${yyyy}-${mm}-${dd} ${hh}:${mi}Z`
  } catch {
    return String(d)
  }
}

function prettyJson(v: unknown): string {
  if (v === undefined) return '—'
  try {
    return JSON.stringify(v, null, 2)
  } catch {
    return String(v)
  }
}

function previewLines(s: string, max = 4): { preview: string; truncated: boolean } {
  const lines = s.split('\n')
  if (lines.length <= max) return { preview: s, truncated: false }
  return { preview: lines.slice(0, max).join('\n'), truncated: true }
}

function ActorCell({
  actorUserId,
  viewingUserId,
  resolved,
}: {
  actorUserId: string
  viewingUserId: string | null | undefined
  resolved: Map<string, AuditTableUser> | undefined
}) {
  const u = resolved?.get(actorUserId)
  const label = u?.username ?? actorUserId
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span className="font-mono text-xs text-ink truncate" title={actorUserId}>
        {label}
      </span>
      {viewingUserId && viewingUserId !== actorUserId && (
        <span
          className="font-mono text-[10px] text-ink-dim truncate"
          title={`acting-as ${viewingUserId}`}
        >
          via {resolved?.get(viewingUserId)?.username ?? viewingUserId}
        </span>
      )}
    </div>
  )
}

function SourcePill({ source }: { source: 'web' | 'bot' | 'rpc' }) {
  const cls =
    source === 'web'
      ? 'bg-accent/15 text-accent border-accent/30'
      : source === 'bot'
        ? 'bg-bg-card2 text-ink-dim border-line'
        : 'bg-warn/15 text-warn border-warn/30'
  return <span className={`${PILL_BASE} ${cls}`}>{source}</span>
}

function ResultPill({ success, errorMessage }: { success: boolean; errorMessage?: string | null }) {
  const cls = success
    ? 'bg-ok/15 text-ok border-ok/30'
    : 'bg-err/15 text-err border-err/30'
  return (
    <span className={`${PILL_BASE} ${cls}`} title={errorMessage ?? undefined}>
      {success ? '✓' : '✗'}
    </span>
  )
}

function FilterChips({
  pathname,
  searchParams,
  filters,
  actionOptions,
}: {
  pathname: string
  searchParams: Record<string, string | undefined>
  filters: AuditTableFilters
  actionOptions: string[] | undefined
}) {
  const successMode = filters.success ?? 'all'
  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Action chip — either a "Clear: foo" link when set, or a quick
          dropdown via <details> when there are options to pick from. */}
      {filters.action ? (
        <Link
          href={buildHref(pathname, searchParams, { action: null, page: null })}
          className={`${PILL_BASE} bg-accent/15 text-accent border-accent/30 hover:bg-accent/25`}
        >
          Action: <span className="font-mono ml-1">{filters.action}</span>
          <span aria-hidden className="ml-1.5">
            ×
          </span>
        </Link>
      ) : actionOptions && actionOptions.length > 0 ? (
        <details className="relative">
          <summary
            className={`${PILL_BASE} bg-bg-card2 text-ink-dim border-line hover:bg-bg-card2/70 cursor-pointer list-none`}
          >
            Action ▾
          </summary>
          <div className="absolute z-10 mt-1 max-h-64 overflow-y-auto rounded-lg border border-line bg-bg-card p-1 min-w-[12rem] shadow-lg">
            {actionOptions.map((a) => (
              <Link
                key={a}
                href={buildHref(pathname, searchParams, { action: a, page: null })}
                className="block px-2 py-1 rounded text-xs font-mono text-ink hover:bg-bg-card2"
              >
                {a}
              </Link>
            ))}
          </div>
        </details>
      ) : (
        <span className={`${PILL_BASE} bg-bg-card2 text-ink-dim border-line opacity-60`}>
          Action: any
        </span>
      )}

      {/* Actor chip — `<Link>` clear when set, otherwise a hint pill. The
          actor query string is set by clicking the actor cell in a row. */}
      {filters.actor ? (
        <Link
          href={buildHref(pathname, searchParams, { actor: null, page: null })}
          className={`${PILL_BASE} bg-accent/15 text-accent border-accent/30 hover:bg-accent/25`}
        >
          Actor: <span className="font-mono ml-1">{filters.actor}</span>
          <span aria-hidden className="ml-1.5">
            ×
          </span>
        </Link>
      ) : (
        <span className={`${PILL_BASE} bg-bg-card2 text-ink-dim border-line opacity-60`}>
          Actor: any
        </span>
      )}

      {/* Success tri-toggle: all → success → failure → all */}
      <div className="inline-flex rounded-full border border-line bg-bg-card2 p-0.5 text-xs">
        {(['all', 'true', 'false'] as const).map((mode) => {
          const active = successMode === mode
          const label = mode === 'all' ? 'All' : mode === 'true' ? 'Success' : 'Failure'
          return (
            <Link
              key={mode}
              href={buildHref(pathname, searchParams, {
                success: mode === 'all' ? null : mode,
                page: null,
              })}
              className={`px-2 py-0.5 rounded-full ${
                active ? 'bg-bg-card text-ink' : 'text-ink-dim hover:text-ink'
              }`}
            >
              {label}
            </Link>
          )
        })}
      </div>
    </div>
  )
}

function DiffCell({
  before,
  after,
  errorMessage,
}: {
  before: unknown
  after: unknown
  errorMessage: string | null | undefined
}) {
  // Build a compact summary for the closed <details> — for setting-style
  // edits with primitive before/after, render "old → new" inline; for
  // structured diffs fall back to "(expand)".
  const beforeJson = prettyJson(before)
  const afterJson = prettyJson(after)
  const showInlineBefore = typeof before === 'string' || typeof before === 'number' || typeof before === 'boolean'
  const showInlineAfter = typeof after === 'string' || typeof after === 'number' || typeof after === 'boolean'
  const hasInline = (before !== undefined && showInlineBefore) || (after !== undefined && showInlineAfter)

  // If neither before nor after are interesting AND we have no error,
  // there's nothing to expand to — render a dim em-dash.
  const hasBefore = before !== undefined && before !== null
  const hasAfter = after !== undefined && after !== null
  if (!hasBefore && !hasAfter && !errorMessage) {
    return <span className="text-ink-dim text-xs">—</span>
  }

  const blob = JSON.stringify({ before, after, error: errorMessage ?? undefined }, null, 2)
  const { preview, truncated } = previewLines(blob, 4)

  return (
    <details className="group">
      <summary className="cursor-pointer list-none text-xs text-ink-dim hover:text-ink">
        {hasInline ? (
          <span className="font-mono">
            {hasBefore && showInlineBefore ? String(before) : '∅'}
            <span aria-hidden className="mx-1">
              →
            </span>
            {hasAfter && showInlineAfter ? String(after) : '∅'}
          </span>
        ) : (
          <span>{truncated ? 'expand ▾' : 'view ▾'}</span>
        )}
      </summary>
      <div className="mt-1 flex flex-col gap-1">
        {(hasBefore || hasAfter) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-1">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-ink-dim mb-0.5">
                Before
              </div>
              <pre className="text-[11px] text-ink-dim font-mono whitespace-pre-wrap break-all bg-bg p-2 rounded border border-line">
                {hasBefore ? beforeJson : '—'}
              </pre>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-ink-dim mb-0.5">
                After
              </div>
              <pre className="text-[11px] text-ink-dim font-mono whitespace-pre-wrap break-all bg-bg p-2 rounded border border-line">
                {hasAfter ? afterJson : '—'}
              </pre>
            </div>
          </div>
        )}
        {errorMessage && (
          <div className="text-[11px] text-err font-mono whitespace-pre-wrap break-all bg-bg p-2 rounded border border-err/30">
            {errorMessage}
          </div>
        )}
        {/* Hidden compact preview kept for screenreaders / search; not
            rendered visually because the grid above is the human view. */}
        <span className="sr-only">{preview}</span>
      </div>
    </details>
  )
}

function Pagination({
  pathname,
  searchParams,
  page,
  totalPages,
}: {
  pathname: string
  searchParams: Record<string, string | undefined>
  page: number
  totalPages: number
}) {
  const prevDisabled = page <= 1
  const nextDisabled = page >= totalPages
  return (
    <nav className="flex items-center justify-between px-3 py-2 border-t border-line bg-bg-card2/40 text-xs text-ink-dim">
      {prevDisabled ? (
        <span className="opacity-50">← prev</span>
      ) : (
        <Link
          href={buildHref(pathname, searchParams, { page: String(page - 1) })}
          className="hover:text-ink"
        >
          ← prev
        </Link>
      )}
      <span>
        {page} / {totalPages}
      </span>
      {nextDisabled ? (
        <span className="opacity-50">next →</span>
      ) : (
        <Link
          href={buildHref(pathname, searchParams, { page: String(page + 1) })}
          className="hover:text-ink"
        >
          next →
        </Link>
      )}
    </nav>
  )
}

export function AuditTable({
  rows,
  page,
  pageSize,
  total,
  pathname,
  searchParams,
  bot: _bot,
  filters = {},
  resolved,
  actionOptions,
}: AuditTableProps) {
  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)))

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <FilterChips
          pathname={pathname}
          searchParams={searchParams}
          filters={filters}
          actionOptions={actionOptions}
        />
        <span className="text-xs text-ink-dim">{total} total</span>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-line bg-bg-card p-6 text-sm text-ink-dim">
          No audit entries match the current filters.
        </div>
      ) : (
        <div className="rounded-xl border border-line bg-bg-card overflow-hidden">
          {/* Header row. The grid template mirrors the one used by each
              data row below; if you tweak one make sure to update the
              other or columns will drift on resize. */}
          <div className="hidden md:grid grid-cols-[10rem_minmax(0,1fr)_10rem_5rem_3rem_minmax(0,2fr)] gap-3 px-3 py-2 text-[10px] uppercase tracking-wider text-ink-dim border-b border-line bg-bg-card2/40">
            <div>When</div>
            <div>Action</div>
            <div>Actor</div>
            <div>Source</div>
            <div>Result</div>
            <div>Diff</div>
          </div>
          <ul className="flex flex-col">
            {rows.map((r) => {
              const actorHref = buildHref(pathname, searchParams, {
                actor: r.actorUserId,
                page: null,
              })
              const actionHref = buildHref(pathname, searchParams, {
                action: r.action,
                page: null,
              })
              return (
                <li
                  key={r.id}
                  className="grid grid-cols-1 md:grid-cols-[10rem_minmax(0,1fr)_10rem_5rem_3rem_minmax(0,2fr)] gap-3 px-3 py-2 border-b border-line last:border-b-0 hover:bg-bg-card2/30 items-start"
                >
                  <div
                    className="text-xs text-ink-dim font-mono whitespace-nowrap"
                    title={r.changedAt.toISOString()}
                  >
                    {fmtWhen(r.changedAt)}
                  </div>
                  <div className="min-w-0">
                    <Link
                      href={actionHref}
                      className="font-mono text-xs text-ink hover:text-accent truncate block"
                      title={`Filter to action: ${r.action}`}
                    >
                      {r.action}
                    </Link>
                  </div>
                  <div className="min-w-0">
                    <Link
                      href={actorHref}
                      className="block hover:opacity-80"
                      title={`Filter to actor: ${r.actorUserId}`}
                    >
                      <ActorCell
                        actorUserId={r.actorUserId}
                        viewingUserId={r.viewingUserId}
                        resolved={resolved}
                      />
                    </Link>
                  </div>
                  <div>
                    <SourcePill source={r.source} />
                  </div>
                  <div>
                    <ResultPill success={r.success} errorMessage={r.errorMessage} />
                  </div>
                  <div className="min-w-0">
                    <DiffCell
                      before={r.before}
                      after={r.after}
                      errorMessage={r.errorMessage}
                    />
                  </div>
                </li>
              )
            })}
          </ul>
          <Pagination
            pathname={pathname}
            searchParams={searchParams}
            page={page}
            totalPages={totalPages}
          />
        </div>
      )}
      {/* Suppress unused-var TS noise — `bot` and `pageSize` are part of
          the public prop contract even when this current render doesn't
          touch them. Wave 7d-B's <UserChip> will read `bot` to pick the
          right user-resolution backend. */}
      <span className="sr-only" data-bot={_bot} data-page-size={pageSize} />
    </div>
  )
}

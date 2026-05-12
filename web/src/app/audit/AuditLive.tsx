'use client'

/**
 * `<AuditLive>` — client-side controller for the unified audit tail.
 *
 * Lifecycle:
 *   1. On mount: GET /api/audit/list?limit=50 for the initial snapshot.
 *   2. Open an EventSource against /api/audit/stream.
 *   3. Every incoming SSE frame is prepended to the in-memory list (capped
 *      at 200 entries — older entries are dropped).
 *   4. New rows briefly highlight via Tailwind's `animate-pulse`.
 *
 * Filtering is purely client-side: bot toggle (all / squishy / otter) and a
 * substring search over `summary | actor | action`. We deliberately don't
 * do server-side filtering for MVP — the list is small (≤200) and the user
 * benefits from being able to switch filters without losing the live tail.
 *
 * EventSource state is mirrored to a small "🟢 Live" / "🔴 Reconnecting"
 * pill in the header. EventSource auto-reconnects on its own; we only flip
 * the pill — we don't intervene.
 */
import { useEffect, useMemo, useState, useRef } from 'react'

type Entry = {
  bot: 'squishy' | 'otter'
  id: string
  ts: string
  actor: string
  action: string
  summary: string
  raw: Record<string, unknown>
}

type BotFilter = 'all' | 'squishy' | 'otter'
type ConnState = 'connecting' | 'live' | 'reconnecting' | 'closed'

const MAX_ENTRIES = 200
const HIGHLIGHT_MS = 1500

function relTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return iso
  const diff = Date.now() - then
  const abs = Math.abs(diff)
  const past = diff >= 0

  const sec = Math.round(abs / 1000)
  if (sec < 5) return 'just now'
  if (sec < 60) return past ? `${sec}s ago` : `in ${sec}s`
  const min = Math.round(sec / 60)
  if (min < 60) return past ? `${min}m ago` : `in ${min}m`
  const hr = Math.round(min / 60)
  if (hr < 24) return past ? `${hr}h ago` : `in ${hr}h`
  const day = Math.round(hr / 24)
  if (day < 30) return past ? `${day}d ago` : `in ${day}d`
  // Beyond a month, fall back to the ISO date — we don't pull a heavy date
  // library just for this page.
  return iso.slice(0, 10)
}

function BotPill({ bot }: { bot: 'squishy' | 'otter' }) {
  if (bot === 'squishy') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-bg-card2 border border-line px-2 py-0.5 text-xs">
        <span aria-hidden>🔸</span>
        <span>squishy</span>
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-bg-card2 border border-line px-2 py-0.5 text-xs">
      <span aria-hidden>🦦</span>
      <span>otter</span>
    </span>
  )
}

function ConnPill({ state }: { state: ConnState }) {
  if (state === 'live') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-bg-card2 border border-line px-2.5 py-1 text-xs">
        <span className="w-2 h-2 rounded-full bg-ok" /> Live
      </span>
    )
  }
  if (state === 'closed') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-bg-card2 border border-line px-2.5 py-1 text-xs text-ink-dim">
        <span className="w-2 h-2 rounded-full bg-ink-dim" /> Closed
      </span>
    )
  }
  // connecting + reconnecting render the same red pill — same recovery action.
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-bg-card2 border border-line px-2.5 py-1 text-xs">
      <span className="w-2 h-2 rounded-full bg-err" />{' '}
      {state === 'connecting' ? 'Connecting' : 'Reconnecting'}
    </span>
  )
}

function Row({
  entry,
  expanded,
  onToggle,
  highlight,
}: {
  entry: Entry
  expanded: boolean
  onToggle: () => void
  highlight: boolean
}) {
  return (
    <>
      <tr
        onClick={onToggle}
        className={`border-b border-line cursor-pointer hover:bg-bg-card2 ${
          highlight ? 'animate-pulse bg-bg-card2' : ''
        }`}
      >
        <td className="px-3 py-2 text-xs text-ink-dim whitespace-nowrap" title={entry.ts}>
          {relTime(entry.ts)}
        </td>
        <td className="px-3 py-2">
          <BotPill bot={entry.bot} />
        </td>
        <td className="px-3 py-2 font-mono text-xs text-ink-dim whitespace-nowrap">
          {entry.actor}
        </td>
        <td className="px-3 py-2 text-sm whitespace-nowrap">{entry.action}</td>
        <td className="px-3 py-2 text-sm text-ink-dim break-all">{entry.summary}</td>
      </tr>
      {expanded && (
        <tr className="border-b border-line bg-bg-card2">
          <td colSpan={5} className="px-3 py-3">
            <pre className="text-xs font-mono text-ink-dim overflow-x-auto whitespace-pre-wrap">
              {JSON.stringify(entry.raw, null, 2)}
            </pre>
          </td>
        </tr>
      )}
    </>
  )
}

export function AuditLive() {
  const [entries, setEntries] = useState<Entry[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [partialErrors, setPartialErrors] = useState<string[]>([])
  const [conn, setConn] = useState<ConnState>('connecting')
  const [botFilter, setBotFilter] = useState<BotFilter>('all')
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  // IDs we should briefly pulse — populated when an SSE event arrives.
  const [recentIds, setRecentIds] = useState<Set<string>>(new Set())
  const seenIds = useRef<Set<string>>(new Set())

  // Initial snapshot.
  useEffect(() => {
    let cancelled = false
    fetch('/api/audit/list?limit=50', { credentials: 'same-origin' })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<{ entries: Entry[]; errors?: string[] }>
      })
      .then((data) => {
        if (cancelled) return
        setEntries(data.entries)
        for (const e of data.entries) seenIds.current.add(e.id)
        setPartialErrors(data.errors ?? [])
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setLoadError(err instanceof Error ? err.message : 'load failed')
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // SSE live tail.
  useEffect(() => {
    const es = new EventSource('/api/audit/stream', { withCredentials: true })

    es.onopen = () => setConn('live')
    es.onerror = () => {
      // EventSource auto-reconnects on its own — just reflect state.
      if (es.readyState === EventSource.CLOSED) {
        setConn('closed')
      } else {
        setConn('reconnecting')
      }
    }
    es.onmessage = (ev) => {
      let entry: Entry
      try {
        entry = JSON.parse(ev.data) as Entry
      } catch {
        return
      }
      // Dedupe: pub/sub can race with the initial-snapshot fetch.
      if (seenIds.current.has(entry.id)) return
      seenIds.current.add(entry.id)

      setEntries((prev) => {
        const next = [entry, ...prev]
        return next.length > MAX_ENTRIES ? next.slice(0, MAX_ENTRIES) : next
      })
      setRecentIds((prev) => {
        const next = new Set(prev)
        next.add(entry.id)
        return next
      })
      // Drop the highlight after a beat.
      setTimeout(() => {
        setRecentIds((prev) => {
          if (!prev.has(entry.id)) return prev
          const next = new Set(prev)
          next.delete(entry.id)
          return next
        })
      }, HIGHLIGHT_MS)
    }

    return () => {
      es.close()
    }
  }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return entries.filter((e) => {
      if (botFilter !== 'all' && e.bot !== botFilter) return false
      if (!q) return true
      return (
        e.summary.toLowerCase().includes(q) ||
        e.actor.toLowerCase().includes(q) ||
        e.action.toLowerCase().includes(q)
      )
    })
  }, [entries, botFilter, search])

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-bg-card p-3">
        <div className="inline-flex rounded-lg border border-line overflow-hidden text-sm">
          {(['all', 'squishy', 'otter'] as const).map((b) => (
            <button
              key={b}
              type="button"
              onClick={() => setBotFilter(b)}
              className={`px-3 py-1.5 capitalize ${
                botFilter === b ? 'bg-accent text-white' : 'bg-bg-card2 text-ink-dim hover:text-ink'
              }`}
            >
              {b}
            </button>
          ))}
        </div>

        <input
          type="search"
          placeholder="Search summary, actor, action…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[12rem] rounded-lg border border-line bg-bg-card2 px-3 py-1.5 text-sm placeholder:text-ink-dim focus:outline-none focus:ring-1 focus:ring-accent"
        />

        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-ink-dim">
            {filtered.length} / {entries.length}
          </span>
          <ConnPill state={conn} />
        </div>
      </div>

      {/* Partial errors */}
      {partialErrors.length > 0 && (
        <div className="rounded-xl border border-line bg-bg-card p-3 text-xs text-warn">
          Initial load had issues: {partialErrors.join(', ')}. Live tail still
          runs — once the failing DB is reachable the next event will appear.
        </div>
      )}

      {/* Table */}
      <div className="rounded-xl border border-line bg-bg-card overflow-hidden">
        {loading ? (
          <div className="p-6 text-sm text-ink-dim">Loading…</div>
        ) : loadError ? (
          <div className="p-6 text-sm text-err">Failed to load: {loadError}</div>
        ) : filtered.length === 0 ? (
          <div className="p-6 text-sm text-ink-dim">
            {entries.length === 0
              ? 'No audit entries yet.'
              : 'No entries match the current filter.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-bg-card2 text-xs uppercase tracking-wider text-ink-dim">
                <tr>
                  <th className="px-3 py-2 font-medium">When</th>
                  <th className="px-3 py-2 font-medium">Bot</th>
                  <th className="px-3 py-2 font-medium">Actor</th>
                  <th className="px-3 py-2 font-medium">Action</th>
                  <th className="px-3 py-2 font-medium">Summary</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((e) => (
                  <Row
                    key={e.id}
                    entry={e}
                    expanded={expanded.has(e.id)}
                    onToggle={() => toggleExpanded(e.id)}
                    highlight={recentIds.has(e.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

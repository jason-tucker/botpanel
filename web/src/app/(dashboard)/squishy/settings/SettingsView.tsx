'use client'

/**
 * `<SettingsView>` — client-side renderer for the `/squishy/settings` table.
 *
 * Receives the full settings dump from the server component (already sorted
 * by key asc) and:
 *  - Groups rows by the first dot-segment of `key` ("feature", "voice", ...).
 *  - Filters live on a search box (substring match against `key`, case-
 *    insensitive). Filtering happens before grouping so an entire namespace
 *    disappears when none of its keys match — keeps the page short.
 *  - Each namespace renders as a `<details open>` block with key/value/when/by.
 *  - Long values get truncated at 80 chars; full value lives in a hover-
 *    revealed `<details>` (click to expand) and as a `title` attribute so a
 *    quick hover surfaces the rest without disturbing layout.
 *
 * Pure presentation — no fetching, no mutation. The viewer is read-only in
 * this MVP; editing lands in a follow-up PR.
 */
import { useMemo, useState } from 'react'

export type SettingRow = {
  key: string
  value: string
  updatedByDiscordId: string | null
  updatedAt: string
}

function relTime(iso: string): string {
  // Hand-rolled rather than pulling in a date dep just for this page —
  // mirrors the helper in `app/audit/AuditLive.tsx`.
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
  return iso.slice(0, 10)
}

function namespaceOf(key: string): string {
  const idx = key.indexOf('.')
  if (idx === -1) return key
  return key.slice(0, idx)
}

const TRUNC = 80

export function SettingsView({ settings }: { settings: SettingRow[] }) {
  const [search, setSearch] = useState('')

  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase()
    const matches = q
      ? settings.filter((s) => s.key.toLowerCase().includes(q))
      : settings

    // Group by first dot-segment. Empty namespaces (impossible given the
    // dataset, but defensive) are skipped.
    const groups = new Map<string, SettingRow[]>()
    for (const row of matches) {
      const ns = namespaceOf(row.key)
      if (!ns) continue
      const list = groups.get(ns) ?? []
      list.push(row)
      groups.set(ns, list)
    }
    // Stable namespace order — alphabetical, since the rows are already
    // key-sorted within each bucket by the server query.
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [settings, search])

  const totalMatched = useMemo(
    () => filteredGroups.reduce((n, [, rows]) => n + rows.length, 0),
    [filteredGroups],
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-bg-card p-3">
        <input
          type="search"
          placeholder="Filter by key (e.g. voice, feature.auto)…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[14rem] rounded-lg border border-line bg-bg-card2 px-3 py-1.5 text-sm placeholder:text-ink-dim focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <span className="text-xs text-ink-dim">
          {totalMatched} / {settings.length} keys
          {filteredGroups.length > 0 ? ` · ${filteredGroups.length} namespaces` : ''}
        </span>
      </div>

      {filteredGroups.length === 0 ? (
        <div className="rounded-xl border border-line bg-bg-card p-6 text-sm text-ink-dim">
          {settings.length === 0
            ? 'No settings found. Either the bot hasn’t written any runtime overrides yet, or the DB is unreachable.'
            : 'No keys match the current filter.'}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {filteredGroups.map(([ns, rows]) => (
            <details
              key={ns}
              open
              className="rounded-xl border border-line bg-bg-card overflow-hidden group"
            >
              <summary className="cursor-pointer list-none px-4 py-3 bg-bg-card2 flex items-center justify-between hover:bg-bg-card">
                <div className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="text-ink-dim text-xs transition-transform group-open:rotate-90"
                  >
                    ▶
                  </span>
                  <span className="font-mono text-sm text-ink">{ns}</span>
                </div>
                <span className="text-xs text-ink-dim">
                  {rows.length} key{rows.length === 1 ? '' : 's'}
                </span>
              </summary>
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-bg-card2 text-xs uppercase tracking-wider text-ink-dim">
                    <tr>
                      <th className="px-3 py-2 font-medium">Key</th>
                      <th className="px-3 py-2 font-medium">Value</th>
                      <th className="px-3 py-2 font-medium">Updated</th>
                      <th className="px-3 py-2 font-medium">By</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const long = r.value.length > TRUNC
                      const preview = long ? `${r.value.slice(0, TRUNC)}…` : r.value
                      return (
                        <tr key={r.key} className="border-t border-line align-top">
                          <td className="px-3 py-2 font-mono text-xs text-ink whitespace-nowrap">
                            {r.key}
                          </td>
                          <td className="px-3 py-2 font-mono text-xs text-ink-dim break-all">
                            {long ? (
                              <details>
                                <summary
                                  className="cursor-pointer list-none hover:text-ink"
                                  title={r.value}
                                >
                                  {preview}
                                </summary>
                                <pre className="mt-1 whitespace-pre-wrap break-all text-ink">
                                  {r.value}
                                </pre>
                              </details>
                            ) : (
                              <span title={r.value}>{r.value}</span>
                            )}
                          </td>
                          <td
                            className="px-3 py-2 text-xs text-ink-dim whitespace-nowrap"
                            title={r.updatedAt}
                          >
                            {relTime(r.updatedAt)}
                          </td>
                          <td className="px-3 py-2 font-mono text-xs text-ink-dim whitespace-nowrap">
                            {r.updatedByDiscordId ? `<@${r.updatedByDiscordId}>` : '—'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </details>
          ))}
        </div>
      )}
    </div>
  )
}

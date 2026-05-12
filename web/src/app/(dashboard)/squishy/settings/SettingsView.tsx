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
 *  - Long values get truncated at 80 chars when read-only; the editable
 *    surface uses an auto-grow `<textarea>` so the whole value is visible
 *    in-place.
 *
 * When `canEdit` is true the per-row value cell becomes a `<ServerForm>`
 * with a Save button (PUT `/api/squishy/settings/<key>`) and a Clear
 * button (DELETE the same path, with confirm). A top "Add new setting"
 * card lets sudo add keys that don't exist yet — same PUT endpoint, the
 * route upserts.
 *
 * `<ServerForm>` lives in `@/lib/forms/ServerForm` (agent T's surface):
 * handles CSRF token injection + render of any 4xx error bodies inline.
 */
import { useMemo, useState } from 'react'
import { ServerForm } from '@/lib/forms/ServerForm'

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
const LONG_THRESHOLD = 60

function ValueCell({
  row,
  canEdit,
}: {
  row: SettingRow
  canEdit: boolean
}) {
  if (!canEdit) {
    const long = row.value.length > TRUNC
    const preview = long ? `${row.value.slice(0, TRUNC)}…` : row.value
    return long ? (
      <details>
        <summary
          className="cursor-pointer list-none hover:text-ink"
          title={row.value}
        >
          {preview}
        </summary>
        <pre className="mt-1 whitespace-pre-wrap break-all text-ink">
          {row.value}
        </pre>
      </details>
    ) : (
      <span title={row.value}>{row.value}</span>
    )
  }

  // Editable surface — auto-grow textarea for long values, plain input
  // for short ones. The form posts to PUT /api/squishy/settings/<key>;
  // ServerForm injects CSRF + surfaces inline errors from 4xx bodies.
  const useTextarea = row.value.length > LONG_THRESHOLD || row.value.includes('\n')

  return (
    <ServerForm
      action={`/api/squishy/settings/${encodeURIComponent(row.key)}`}
      method="PUT"
      className="flex flex-col gap-2"
    >
      {useTextarea ? (
        <textarea
          name="value"
          defaultValue={row.value}
          rows={Math.min(8, Math.max(2, row.value.split('\n').length))}
          className="w-full min-w-[20rem] rounded border border-line bg-bg-card2 px-2 py-1 font-mono text-xs text-ink focus:outline-none focus:ring-1 focus:ring-accent"
        />
      ) : (
        <input
          type="text"
          name="value"
          defaultValue={row.value}
          className="w-full min-w-[20rem] rounded border border-line bg-bg-card2 px-2 py-1 font-mono text-xs text-ink focus:outline-none focus:ring-1 focus:ring-accent"
        />
      )}
      <div className="flex items-center gap-2">
        <button
          type="submit"
          className="rounded border border-line bg-bg-card2 px-2 py-0.5 text-xs text-ink hover:bg-bg-card"
        >
          Save
        </button>
        <ClearButton settingKey={row.key} />
      </div>
    </ServerForm>
  )
}

function ClearButton({ settingKey }: { settingKey: string }) {
  return (
    <ServerForm
      action={`/api/squishy/settings/${encodeURIComponent(settingKey)}`}
      method="DELETE"
      confirm={`Clear setting "${settingKey}"? This deletes the override; the bot will fall back to its env/code default.`}
      className="inline"
    >
      <button
        type="submit"
        className="rounded border border-err/30 bg-err/10 px-2 py-0.5 text-xs text-err hover:bg-err/20"
      >
        Clear
      </button>
    </ServerForm>
  )
}

function AddSettingForm() {
  return (
    <ServerForm
      action="/api/squishy/settings/__new__"
      method="PUT"
      // Rewrite action client-side once the key field is filled — we still
      // need *some* placeholder so the form is valid HTML, and ServerForm
      // re-resolves the action on submit. Plain JS fallback below.
      onResolveAction={(form: HTMLFormElement) => {
        const k = (form.elements.namedItem('key') as HTMLInputElement | null)?.value?.trim()
        if (!k) return null
        return `/api/squishy/settings/${encodeURIComponent(k)}`
      }}
      className="rounded-xl border border-line bg-bg-card p-3 flex flex-col gap-3"
    >
      <div className="flex flex-col gap-1">
        <label className="text-xs uppercase tracking-wider text-ink-dim">
          Add new setting
        </label>
        <p className="text-xs text-ink-dim">
          Key shape: lowercase + dots (e.g. <code className="font-mono">feature.foo</code>).
          Stored in <code className="font-mono">bot_settings</code>; the bot reads from here
          before falling back to env / defaults.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <input
          type="text"
          name="key"
          placeholder="feature.example"
          required
          className="w-56 rounded border border-line bg-bg-card2 px-2 py-1 font-mono text-xs text-ink focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <input
          type="text"
          name="value"
          placeholder="value"
          required
          className="flex-1 min-w-[14rem] rounded border border-line bg-bg-card2 px-2 py-1 font-mono text-xs text-ink focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <button
          type="submit"
          className="rounded border border-line bg-bg-card2 px-3 py-1 text-xs text-ink hover:bg-bg-card"
        >
          Add
        </button>
      </div>
    </ServerForm>
  )
}

export function SettingsView({
  settings,
  canEdit = false,
}: {
  settings: SettingRow[]
  canEdit?: boolean
}) {
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
      {canEdit && <AddSettingForm />}

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
                    {rows.map((r) => (
                      <tr key={r.key} className="border-t border-line align-top">
                        <td className="px-3 py-2 font-mono text-xs text-ink whitespace-nowrap">
                          {r.key}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-ink-dim break-all">
                          <ValueCell row={r} canEdit={canEdit} />
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
                    ))}
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

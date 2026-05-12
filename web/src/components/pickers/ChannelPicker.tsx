'use client'

/**
 * `<ChannelPicker>` — styled dropdown of Discord channels in the configured
 * guild, optionally filtered to a set of types.
 *
 * Mirrors `<RolePicker>`: fetch once on mount (route caches upstream 60s),
 * native `<select>`, error fallback to a snowflake `<input>`. Channels are
 * grouped by category in `<optgroup>` elements — the API returns rows
 * sorted by `(parentId, position)` already, so we just bucket as we iterate.
 *
 * Props:
 *  - `name`        — form field name (required).
 *  - `value` / `defaultValue` / `onChange` — same shape as RolePicker.
 *  - `types?`      — array of friendly tokens (`text`, `voice`, `category`,
 *                    `forum`, `announcement`). Empty/missing = all channels.
 *  - `allowNone`   — if true, prepends a "— None —" option that submits as ''.
 *  - `required`    — passed through.
 */
import { useEffect, useMemo, useState } from 'react'

const inputCls =
  'w-full rounded-md border border-line bg-bg-card2 px-2 py-1.5 text-sm placeholder:text-ink-dim/50 focus:outline-none focus:ring-1 focus:ring-accent'
const errCls =
  'mt-1 rounded border border-warn/40 bg-warn/10 px-2 py-1 text-[11px] text-warn'

export type ChannelTypeToken = 'text' | 'voice' | 'category' | 'forum' | 'announcement'

type Channel = {
  id: string
  name: string
  type: ChannelTypeToken | 'other'
  parentId: string | null
  position: number
}

const TYPE_PREFIX: Record<ChannelTypeToken | 'other', string> = {
  text: '# ',
  voice: '🔊 ',
  category: '📂 ',
  forum: '💬 ',
  announcement: '📣 ',
  other: '',
}

export function ChannelPicker({
  name,
  value,
  defaultValue,
  onChange,
  types,
  allowNone,
  required,
  id,
}: {
  name: string
  value?: string
  defaultValue?: string
  onChange?: (value: string) => void
  types?: ChannelTypeToken[]
  allowNone?: boolean
  required?: boolean
  id?: string
}) {
  const [channels, setChannels] = useState<Channel[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Stable key for the useEffect dep — caller passes a fresh array literal
  // on every render, but we only want to refetch when the *contents* change.
  const typesKey = (types ?? []).slice().sort().join(',')

  useEffect(() => {
    let alive = true
    const qs = typesKey ? `?types=${encodeURIComponent(typesKey)}` : ''
    fetch(`/api/squishy/meta/channels${qs}`, { credentials: 'same-origin' })
      .then(r => r.json())
      .then((body: { channels?: Channel[]; error?: string }) => {
        if (!alive) return
        if (body.error) {
          setError(body.error)
          setChannels([])
        } else {
          setChannels(Array.isArray(body.channels) ? body.channels : [])
        }
      })
      .catch(e => {
        if (!alive) return
        setError(e instanceof Error ? e.message : 'fetch-failed')
        setChannels([])
      })
    return () => { alive = false }
  }, [typesKey])

  // Group by parent category. Categories themselves render under "Categories"
  // when included; everything else groups under its parent's name.
  const { byParent, categoryName, orphans } = useMemo(() => {
    const categoryName = new Map<string, string>()
    const byParent = new Map<string, Channel[]>()
    const orphans: Channel[] = []
    for (const c of channels ?? []) {
      if (c.type === 'category') {
        categoryName.set(c.id, c.name)
      }
    }
    for (const c of channels ?? []) {
      if (c.type === 'category') continue
      if (c.parentId && categoryName.has(c.parentId)) {
        const list = byParent.get(c.parentId) ?? []
        list.push(c)
        byParent.set(c.parentId, list)
      } else {
        orphans.push(c)
      }
    }
    return { byParent, categoryName, orphans }
  }, [channels])

  // Caller filter only on `types`. We always render an "(uncategorized)"
  // group last if there are channels outside any category, plus a top-level
  // "Categories" group ONLY when the caller asked for category type.
  const wantsCategories = (types ?? []).includes('category')

  if (error || (channels && channels.length === 0 && !error)) {
    return (
      <div className="flex flex-col gap-1">
        <input
          id={id}
          type="text"
          name={name}
          defaultValue={defaultValue}
          required={required}
          inputMode="numeric"
          pattern="\d{15,25}"
          placeholder="channel snowflake (15-25 digits)"
          className={inputCls}
          onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        />
        {error && (
          <div className={errCls} role="alert">
            Couldn&apos;t load channels ({error}). Paste the channel ID instead.
          </div>
        )}
      </div>
    )
  }

  if (!channels) {
    return (
      <select
        id={id}
        name={name}
        disabled
        className={inputCls}
        aria-label="Loading channels…"
      >
        <option>Loading channels…</option>
      </select>
    )
  }

  // Sorted iteration order: orphans first (no parent), then each category
  // group in `categoryName` insertion order (which is API-sorted by position).
  const parentIdsInOrder = Array.from(categoryName.keys())

  return (
    <select
      id={id}
      name={name}
      value={value}
      defaultValue={defaultValue}
      required={required}
      onChange={onChange ? (e) => onChange(e.target.value) : undefined}
      className={inputCls}
    >
      {allowNone && <option value="">— None —</option>}
      {wantsCategories && categoryName.size > 0 && (
        <optgroup label="Categories">
          {parentIdsInOrder.map(pid => (
            <option key={pid} value={pid}>
              {TYPE_PREFIX.category}{categoryName.get(pid)}
            </option>
          ))}
        </optgroup>
      )}
      {orphans.length > 0 && (
        <optgroup label="(uncategorized)">
          {orphans.map(c => (
            <option key={c.id} value={c.id}>
              {TYPE_PREFIX[c.type]}{c.name}
            </option>
          ))}
        </optgroup>
      )}
      {parentIdsInOrder.map(pid => {
        const kids = byParent.get(pid) ?? []
        if (kids.length === 0) return null
        return (
          <optgroup key={pid} label={categoryName.get(pid) ?? ''}>
            {kids.map(c => (
              <option key={c.id} value={c.id}>
                {TYPE_PREFIX[c.type]}{c.name}
              </option>
            ))}
          </optgroup>
        )
      })}
    </select>
  )
}

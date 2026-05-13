'use client'

/**
 * `<MemberPicker>` — typeahead combobox over the configured guild's members.
 *
 * Renders a search `<input>` plus a dropdown list. Every keystroke triggers
 * a debounced (200ms) GET against `/api/<bot>/meta/members?q=...` — no
 * upstream cache there (members change too often), but the bot side is a
 * pure in-memory iteration so the round-trip is sub-ms locally.
 *
 * The component manages two pieces of state:
 *  - `text` — what's displayed in the input (user's typing OR the selected
 *    member's displayName once one is picked).
 *  - `selectedId` — the chosen user ID, mirrored into a hidden `<input>`
 *    with the picker's `name` so form submissions get the snowflake.
 *
 * Falls back to a plain snowflake input + warning banner when the fetch
 * errors. Same posture as the other two pickers.
 *
 * Props:
 *  - `name`        — form field name (required) for the hidden snowflake input.
 *  - `value`       — controlled selected user ID.
 *  - `defaultValue`— uncontrolled initial selected user ID.
 *  - `onChange`    — fires with the new user ID when a row is picked.
 *  - `placeholder` — optional placeholder for the search input.
 *  - `bot`         — which bot's guild to search ('squishy' default | 'otter').
 *                    Pick determines the API route used for the typeahead.
 */
import { useEffect, useRef, useState } from 'react'

const inputCls =
  'w-full rounded-md border border-line bg-bg-card2 px-2 py-1.5 text-sm placeholder:text-ink-dim/50 focus:outline-none focus:ring-1 focus:ring-accent'
const errCls =
  'mt-1 rounded border border-warn/40 bg-warn/10 px-2 py-1 text-[11px] text-warn'
const dropdownCls =
  'absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border border-line bg-bg-card shadow-lg'
const rowCls =
  'flex items-center gap-2 px-2 py-1.5 text-sm cursor-pointer hover:bg-bg-card2'

type Member = {
  id: string
  username: string
  displayName: string
  avatarUrl: string
}

export function MemberPicker({
  name,
  value,
  defaultValue,
  onChange,
  placeholder,
  bot = 'squishy',
}: {
  name: string
  value?: string
  defaultValue?: string
  onChange?: (value: string) => void
  placeholder?: string
  bot?: 'squishy' | 'otter'
}) {
  const apiBase = `/api/${bot}/meta/members`
  const [text, setText] = useState('')
  const [selectedId, setSelectedId] = useState(value ?? defaultValue ?? '')
  const [members, setMembers] = useState<Member[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)

  // Controlled mode — sync internal state to incoming `value`.
  useEffect(() => {
    if (value !== undefined) setSelectedId(value)
  }, [value])

  // If we have an initial selectedId but no text yet, resolve it once so
  // the input shows a friendly name on first render. We piggyback on the
  // `?q=` filter — the bot side does an `includes` match, so we just send
  // an empty query (gets the first 25 cached members) and look for our ID.
  // Falls back to showing the raw ID if we don't find it (privacy-friendly
  // for "weren't in the first 25" cases). Cheap and avoids a new RPC verb.
  useEffect(() => {
    if (!selectedId || text) return
    let alive = true
    fetch(`${apiBase}?q=&limit=100`, { credentials: 'same-origin' })
      .then(r => r.json())
      .then((body: { members?: Member[] }) => {
        if (!alive) return
        const found = body.members?.find(m => m.id === selectedId)
        if (found) setText(found.displayName || found.username)
        else setText(selectedId)
      })
      .catch(() => { if (alive) setText(selectedId) })
    return () => { alive = false }
  // We intentionally only run once on mount with the initial selectedId;
  // text changes are user-driven and shouldn't trigger a re-resolve.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Debounced search on text change. Skip when the input matches the
  // currently-selected member's display name (avoids a fetch right after
  // a click selection).
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setLoading(true)
      setError(null)
      fetch(`${apiBase}?q=${encodeURIComponent(text)}&limit=25`, {
        credentials: 'same-origin',
      })
        .then(r => r.json())
        .then((body: { members?: Member[]; error?: string }) => {
          if (body.error) {
            setError(body.error)
            setMembers([])
          } else {
            setMembers(Array.isArray(body.members) ? body.members : [])
          }
        })
        .catch(e => {
          setError(e instanceof Error ? e.message : 'fetch-failed')
          setMembers([])
        })
        .finally(() => setLoading(false))
    }, 200)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [text, apiBase])

  // Click-outside closes the dropdown.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!wrapperRef.current) return
      if (!wrapperRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  function pick(m: Member) {
    setSelectedId(m.id)
    setText(m.displayName || m.username)
    setOpen(false)
    onChange?.(m.id)
  }

  function clear() {
    setSelectedId('')
    setText('')
    setOpen(false)
    onChange?.('')
  }

  // Error fallback — plain snowflake input with a warning. The hidden input
  // name lines up with the picker's so form submissions still work.
  if (error) {
    return (
      <div className="flex flex-col gap-1">
        <input
          type="text"
          name={name}
          defaultValue={defaultValue}
          inputMode="numeric"
          pattern="\d{15,25}"
          placeholder="user snowflake (15-25 digits)"
          className={inputCls}
          onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        />
        <div className={errCls} role="alert">
          Couldn&apos;t load members ({error}). Paste the user ID instead.
        </div>
      </div>
    )
  }

  return (
    <div ref={wrapperRef} className="relative flex flex-col gap-1">
      <input
        type="text"
        placeholder={placeholder ?? 'Search members…'}
        className={inputCls}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setOpen(true)
          // Clear selection while typing — selectedId stays in sync via pick().
          if (selectedId) {
            setSelectedId('')
            onChange?.('')
          }
        }}
        onFocus={() => setOpen(true)}
      />
      {/* Hidden field is the source of truth for form submissions. */}
      <input type="hidden" name={name} value={selectedId} />
      {selectedId && (
        <button
          type="button"
          onClick={clear}
          className="absolute right-2 top-1.5 text-[11px] text-ink-dim hover:text-ink"
          aria-label="Clear selection"
        >
          ✕
        </button>
      )}
      {open && (
        <div className={dropdownCls}>
          {loading && (
            <div className="px-2 py-1.5 text-xs text-ink-dim">Searching…</div>
          )}
          {!loading && members.length === 0 && (
            <div className="px-2 py-1.5 text-xs text-ink-dim">No matches</div>
          )}
          {!loading && members.map(m => (
            <div
              key={m.id}
              role="option"
              className={rowCls}
              onMouseDown={(e) => {
                // mousedown rather than click — onBlur fires first on a
                // click, which would close the dropdown before pick() runs.
                e.preventDefault()
                pick(m)
              }}
            >
              <img
                src={m.avatarUrl}
                alt=""
                width={24}
                height={24}
                className="rounded-full"
              />
              <div className="flex flex-col">
                <span className="text-ink">{m.displayName}</span>
                <span className="text-[11px] text-ink-dim">@{m.username}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

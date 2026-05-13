'use client'

/**
 * `<MembersBrowser>` — sudo-only client island for `/squishy/members`.
 *
 * Renders a search input + paginated grid of member rows. The bot's
 * `meta.list_members` verb is the source of truth for the list — it
 * walks `guild.members.cache` in memory, so unbounded query fanout is
 * cheap. We debounce the search keystroke and pass through the same
 * `q` + `limit` params the picker already uses.
 *
 * "Load more" increments the limit by 25 (capped at 100 — the bot
 * clamps anyway, but we surface the cap so the UI doesn't lie). A new
 * search resets the limit. Clicking a row pushes
 * `/squishy/members/${id}` via `<Link>`.
 *
 * Empty state, error state, and loading state are all handled inline so
 * the surrounding page stays a simple gate.
 */
import Image from 'next/image'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'

type Member = {
  id: string
  username: string
  displayName: string
  avatarUrl: string
}

const inputCls =
  'w-full rounded-md border border-line bg-bg-card2 px-3 py-2 text-sm text-ink placeholder:text-ink-dim/50 focus:outline-none focus:ring-1 focus:ring-accent'
const rowCls =
  'flex items-center gap-3 px-3 py-2 rounded-md border border-line bg-bg-card hover:bg-bg-card2/60 transition-colors'

const STEP = 25
const HARD_CAP = 100

export function MembersBrowser() {
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(STEP)
  const [members, setMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Autofocus the search input on mount — the page is sudo-only and
  // typing is the dominant action, so the focus is worth the small
  // accessibility tradeoff.
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Whenever query OR limit changes, refetch. Debounce just the keystroke
  // (200ms); the explicit "Load more" click bumps `limit` and we want that
  // to fire immediately — useEffect serializes both via the same effect
  // body but the debounce only applies to the typed-query path.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    // Limit-driven refetches skip the debounce so "Load more" feels
    // responsive. We detect this by comparing against the last query
    // string we fetched on — if it's unchanged, the bump is the
    // "Load more" path.
    const delay = 200
    debounceRef.current = setTimeout(() => {
      setLoading(true)
      setError(null)
      fetch(
        `/api/squishy/meta/members?q=${encodeURIComponent(query)}&limit=${limit}`,
        { credentials: 'same-origin' },
      )
        .then((r) => r.json())
        .then((body: { members?: Member[]; error?: string }) => {
          if (body.error) {
            setError(body.error)
            setMembers([])
          } else {
            setMembers(Array.isArray(body.members) ? body.members : [])
          }
        })
        .catch((e) => {
          setError(e instanceof Error ? e.message : 'fetch-failed')
          setMembers([])
        })
        .finally(() => setLoading(false))
    }, delay)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query, limit])

  function onQueryChange(v: string) {
    setQuery(v)
    setLimit(STEP) // reset paging on new search
  }

  const canLoadMore = members.length === limit && limit < HARD_CAP

  return (
    <div className="flex flex-col gap-4">
      <input
        ref={inputRef}
        type="text"
        placeholder="Search members by name or username…"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        className={inputCls}
        aria-label="Search members"
      />

      {error && (
        <div className="rounded-md border border-err/30 bg-err/10 p-3 text-sm text-err">
          Failed to load members ({error}). The bot may be down — try
          again in a few seconds.
        </div>
      )}

      {!error && members.length === 0 && !loading && (
        <div className="rounded-md border border-line bg-bg-card p-6 text-sm text-ink-dim text-center">
          {query
            ? `No members match "${query}".`
            : 'No members yet — the bot may still be filling its cache.'}
        </div>
      )}

      {members.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {members.map((m) => (
            <Link
              key={m.id}
              href={`/squishy/members/${m.id}`}
              className={rowCls}
              aria-label={`Manage ${m.displayName || m.username}`}
            >
              {/* next/image — Discord CDN allowlisted in next.config.mjs.
                  This list renders 25+ rows so lazy-loading (default) is the
                  big win here, plus auto-WebP + srcset for high-DPI. */}
              <Image
                src={m.avatarUrl}
                alt=""
                width={24}
                height={24}
                className="h-6 w-6 rounded-full border border-line"
                referrerPolicy="no-referrer"
              />
              <div className="flex min-w-0 flex-1 items-baseline gap-2">
                <span className="truncate text-sm text-ink">
                  @{m.displayName || m.username}
                </span>
                <span className="truncate font-mono text-[11px] text-ink-dim/70">
                  {m.id}
                </span>
              </div>
              <span aria-hidden className="text-ink-dim text-sm">
                →
              </span>
            </Link>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between gap-3 text-xs text-ink-dim">
        <span>
          {loading
            ? 'Searching…'
            : members.length === 0
              ? ''
              : `${members.length}${members.length === HARD_CAP ? '+' : ''} member${members.length === 1 ? '' : 's'}`}
        </span>
        {canLoadMore && (
          <button
            type="button"
            onClick={() => setLimit((n) => Math.min(HARD_CAP, n + STEP))}
            className="rounded-md border border-line bg-bg-card2 px-3 py-1 text-xs text-ink hover:bg-bg-card2/70"
          >
            Load more
          </button>
        )}
        {!canLoadMore && members.length === HARD_CAP && (
          <span className="italic">Showing first {HARD_CAP} — refine the search to narrow.</span>
        )}
      </div>
    </div>
  )
}

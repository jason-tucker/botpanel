'use client'

/**
 * Live Active Voice Channels — initial snapshot + SSE delta merge.
 *
 * Lifecycle:
 *  1. On mount: fetch /api/squishy/voice/list once for the initial state.
 *  2. Open an EventSource on /api/squishy/voice/stream and merge each
 *     event into the local map by `voiceChannelId`.
 *  3. EventSource auto-reconnects with its own backoff — we just reflect
 *     `readyState` in the indicator (Live / Reconnecting).
 *
 * We keep channels in a Map<voiceChannelId, Channel> rather than an array
 * because every event is a point-update; an O(N) array find on each event
 * would be wasteful even at low scale. We derive the sorted array (newest
 * first) once per render via useMemo.
 *
 * Username lookup: the snapshot endpoint pre-resolves all visible ids to
 * `@displayName` + avatar via the `users.resolve` RPC verb. SSE-driven
 * deltas may introduce new ids (member_join, owner_changed) that the
 * snapshot didn't have — a progressive `enhanceUser(id)` fetches each
 * one via `/api/squishy/users/[id]` and patches the chip in place. Raw
 * snowflake remains the fallback whenever resolution hasn't landed yet.
 */
import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { VoiceControls } from './VoiceControls'

type Member = {
  userId: string
  joinedAt: string
}

type Channel = {
  voiceChannelId: string
  textChannelId?: string
  name: string
  ownerUserId: string
  actingOwnerUserId: string | null
  hostUserIds: string[]
  locked: boolean
  hidden: boolean
  createdAt: string
  members: Member[]
  canControl: boolean
}

type ResolvedUser = {
  username: string
  displayName: string
  avatarUrl: string
}

type SnapshotResponse = {
  channels: Channel[]
  resolved?: Record<string, ResolvedUser>
  error?: string
}

type StreamEvent = {
  event: string
  payload: Record<string, unknown>
}

type Status = 'connecting' | 'live' | 'reconnecting'

function relativeTime(iso: string, now: number): string {
  const then = Date.parse(iso)
  if (!Number.isFinite(then)) return '?'
  const sec = Math.max(0, Math.round((now - then) / 1000))
  if (sec < 60) return `${sec}s ago`
  const min = Math.round(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.round(hr / 24)
  return `${day}d ago`
}

// ---------------------------------------------------------------------------
// Event-merge helpers. Each takes the current channel state and an event
// payload, returns the new state. Pure functions so the reducer below stays
// readable.
// ---------------------------------------------------------------------------

function asString(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}

function applyCreated(map: Map<string, Channel>, p: Record<string, unknown>): Map<string, Channel> {
  const id = asString(p.voiceChannelId)
  if (!id) return map
  if (map.has(id)) return map // server already had it — snapshot wins
  const next = new Map(map)
  next.set(id, {
    voiceChannelId: id,
    textChannelId: asString(p.textChannelId) ?? undefined,
    name: asString(p.name) ?? 'Unnamed channel',
    ownerUserId: asString(p.ownerUserId) ?? '',
    actingOwnerUserId: null,
    hostUserIds: [],
    locked: false,
    hidden: false,
    createdAt: asString(p.ts) ?? new Date().toISOString(),
    members: [],
    // New cards arriving via SSE don't carry the viewer's control flag — only
    // the snapshot can compute that. Pessimistic default so a viewer who got
    // the page open before a new room appeared doesn't see fake controls;
    // the next `router.refresh()` (or a snapshot refetch) will fill it in
    // for real. The API routes also re-gate server-side regardless.
    canControl: false,
  })
  return next
}

function applyDeleted(map: Map<string, Channel>, p: Record<string, unknown>): Map<string, Channel> {
  const id = asString(p.voiceChannelId)
  if (!id || !map.has(id)) return map
  const next = new Map(map)
  next.delete(id)
  return next
}

function applyMemberJoin(map: Map<string, Channel>, p: Record<string, unknown>): Map<string, Channel> {
  const id = asString(p.channelId)
  const userId = asString(p.userId)
  if (!id || !userId) return map
  const ch = map.get(id)
  if (!ch) return map
  if (ch.members.some((m) => m.userId === userId)) return map
  const joinedAt = asString(p.ts) ?? new Date().toISOString()
  const next = new Map(map)
  next.set(id, { ...ch, members: [...ch.members, { userId, joinedAt }] })
  return next
}

function applyMemberLeave(map: Map<string, Channel>, p: Record<string, unknown>): Map<string, Channel> {
  const id = asString(p.channelId)
  const userId = asString(p.userId)
  if (!id || !userId) return map
  const ch = map.get(id)
  if (!ch) return map
  const remaining = ch.members.filter((m) => m.userId !== userId)
  if (remaining.length === ch.members.length) return map
  const next = new Map(map)
  next.set(id, { ...ch, members: remaining })
  return next
}

function applyLockToggled(map: Map<string, Channel>, p: Record<string, unknown>): Map<string, Channel> {
  const id = asString(p.voiceChannelId)
  if (!id) return map
  const ch = map.get(id)
  if (!ch) return map
  const next = new Map(map)
  next.set(id, { ...ch, locked: Boolean(p.isLocked) })
  return next
}

function applyHiddenToggled(map: Map<string, Channel>, p: Record<string, unknown>): Map<string, Channel> {
  const id = asString(p.voiceChannelId)
  if (!id) return map
  const ch = map.get(id)
  if (!ch) return map
  const next = new Map(map)
  next.set(id, { ...ch, hidden: Boolean(p.isHidden) })
  return next
}

function applyOwnerChanged(map: Map<string, Channel>, p: Record<string, unknown>): Map<string, Channel> {
  const id = asString(p.voiceChannelId)
  const newOwner = asString(p.newOwnerUserId)
  if (!id || !newOwner) return map
  const ch = map.get(id)
  if (!ch) return map
  const next = new Map(map)
  // The bot publishes a single owner-changed event whether this was a real
  // owner transfer or an acting-owner promotion. Always set ownerUserId
  // and clear the acting field — if there's a grace-window split the bot
  // will publish another event when it resolves.
  next.set(id, { ...ch, ownerUserId: newOwner, actingOwnerUserId: null })
  return next
}

// ---------------------------------------------------------------------------
// Main component.
// ---------------------------------------------------------------------------

export function VoiceLive() {
  const [channels, setChannels] = useState<Map<string, Channel>>(() => new Map())
  const [status, setStatus] = useState<Status>('connecting')
  const [snapshotError, setSnapshotError] = useState<string | null>(null)
  const [loadedSnapshot, setLoadedSnapshot] = useState(false)
  // Tick once a second so relative timestamps refresh without us having to
  // re-render on every event. Cheap because the map renders are memo-cheap.
  const [now, setNow] = useState(() => Date.now())
  // Snapshot ships pre-resolved usernames; SSE deltas introduce new ids
  // (`member_join`, `owner_changed`, freshly-created channels) which we
  // enhance one-by-one via /api/squishy/users/[id]. `inFlight` dedups so
  // a flood of joins for the same id doesn't fan out into N parallel
  // fetches.
  const [resolved, setResolved] = useState<Map<string, ResolvedUser>>(() => new Map())
  const inFlight = useRef<Set<string>>(new Set())

  const enhanceUser = useCallback(async (userId: string) => {
    if (!userId) return
    if (inFlight.current.has(userId)) return
    inFlight.current.add(userId)
    try {
      const res = await fetch(`/api/squishy/users/${userId}`, { credentials: 'same-origin' })
      if (!res.ok) return
      const data = (await res.json()) as {
        username: string | null
        displayName: string | null
        avatarUrl: string | null
      }
      if (data.username && data.displayName && data.avatarUrl) {
        setResolved((prev) => {
          if (prev.has(userId)) return prev
          const next = new Map(prev)
          next.set(userId, {
            username: data.username!,
            displayName: data.displayName!,
            avatarUrl: data.avatarUrl!,
          })
          return next
        })
      }
    } catch {
      // Network error; the chip falls back to the raw id. Try again on
      // the next render cycle that references this id.
    } finally {
      inFlight.current.delete(userId)
    }
  }, [])

  const esRef = useRef<EventSource | null>(null)

  // ── Snapshot fetch ──────────────────────────────────────────────────
  // Exposed as a callback so per-card controls can refetch after a write
  // (rename has no bot event today, and we want the canControl flag to be
  // re-derived when ownership changes hands).
  const fetchSnapshot = useCallback(async () => {
    try {
      const res = await fetch('/api/squishy/voice/list', { credentials: 'same-origin' })
      if (!res.ok) throw new Error(`snapshot HTTP ${res.status}`)
      const data = (await res.json()) as SnapshotResponse
      const m = new Map<string, Channel>()
      for (const c of data.channels) m.set(c.voiceChannelId, c)
      setChannels(m)
      // Merge any newly-shipped resolutions in — don't overwrite, since
      // SSE-driven enhances may have already filled an id the snapshot
      // didn't have (rare race but cheap to handle).
      if (data.resolved) {
        setResolved((prev) => {
          const next = new Map(prev)
          for (const [id, v] of Object.entries(data.resolved!)) {
            if (!next.has(id)) next.set(id, v)
          }
          return next
        })
      }
      if (data.error) setSnapshotError(data.error)
      else setSnapshotError(null)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setSnapshotError(msg)
    } finally {
      setLoadedSnapshot(true)
    }
  }, [])

  useEffect(() => {
    void fetchSnapshot()
  }, [fetchSnapshot])

  // ── SSE subscription ───────────────────────────────────────────────
  useEffect(() => {
    const es = new EventSource('/api/squishy/voice/stream')
    esRef.current = es

    es.onopen = () => setStatus('live')
    es.onerror = () => {
      // EventSource handles its own reconnection — we just reflect the
      // state to the user so they know we may be momentarily out of date.
      setStatus(es.readyState === EventSource.CLOSED ? 'reconnecting' : 'reconnecting')
    }
    es.onmessage = (ev) => {
      let parsed: StreamEvent
      try {
        parsed = JSON.parse(ev.data) as StreamEvent
      } catch {
        return
      }
      const payload = (parsed.payload ?? {}) as Record<string, unknown>
      setChannels((prev) => {
        switch (parsed.event) {
          case 'channel_created':
            return applyCreated(prev, payload)
          case 'channel_deleted':
            return applyDeleted(prev, payload)
          case 'member_join':
            return applyMemberJoin(prev, payload)
          case 'member_leave':
            return applyMemberLeave(prev, payload)
          case 'lock_toggled':
            return applyLockToggled(prev, payload)
          case 'hidden_toggled':
            return applyHiddenToggled(prev, payload)
          case 'owner_changed':
            return applyOwnerChanged(prev, payload)
          // hosts_changed / lockdown_started / lockdown_ended are wired up
          // by the firehose but don't impact the snapshot shape today.
          default:
            return prev
        }
      })
    }

    return () => {
      es.close()
      esRef.current = null
    }
  }, [])

  // ── Tick for relative timestamps ───────────────────────────────────
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  // ── Progressive enhancement: chase any unresolved id ────────────────
  // Every time the channel state changes (snapshot refresh, SSE join,
  // owner transfer), scan the visible ids and queue a single-id fetch
  // for anyone we don't have a chip for yet. `enhanceUser` has its own
  // in-flight dedup so this can run on every channel-state churn.
  useEffect(() => {
    for (const c of channels.values()) {
      if (c.ownerUserId && !resolved.has(c.ownerUserId)) void enhanceUser(c.ownerUserId)
      if (c.actingOwnerUserId && !resolved.has(c.actingOwnerUserId)) void enhanceUser(c.actingOwnerUserId)
      for (const h of c.hostUserIds) {
        if (!resolved.has(h)) void enhanceUser(h)
      }
      for (const m of c.members) {
        if (!resolved.has(m.userId)) void enhanceUser(m.userId)
      }
    }
  }, [channels, resolved, enhanceUser])

  const sorted = useMemo(() => {
    return Array.from(channels.values()).sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    )
  }, [channels])

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between rounded-2xl border border-line bg-bg-card p-4">
        <div className="flex items-baseline gap-3">
          <span className="text-xs uppercase tracking-wider text-ink-dim">
            Active
          </span>
          <span className="text-xl font-semibold">{sorted.length}</span>
          <span className="text-ink-dim text-sm">
            channel{sorted.length === 1 ? '' : 's'}
          </span>
        </div>
        <StatusBadge status={status} />
      </div>

      {snapshotError && (
        <div className="rounded-lg border border-line bg-bg-card2 p-3 text-sm text-ink-dim">
          Snapshot failed ({snapshotError}). Live updates will still flow.
        </div>
      )}

      {!loadedSnapshot && (
        <div className="rounded-2xl border border-line bg-bg-card p-6 text-ink-dim">
          Loading initial snapshot…
        </div>
      )}

      {loadedSnapshot && sorted.length === 0 && (
        <div className="rounded-2xl border border-line bg-bg-card p-6 text-ink-dim">
          No active voice channels right now.
        </div>
      )}

      <div className="flex flex-col gap-3">
        {sorted.map((c) => (
          <ChannelCard
            key={c.voiceChannelId}
            channel={c}
            now={now}
            resolved={resolved}
            onMutated={fetchSnapshot}
          />
        ))}
      </div>
    </section>
  )
}

/**
 * Inline UserChip variant for this client component. Renders `[avatar]
 * @displayName` when we've resolved the id; otherwise a monospace raw
 * snowflake with a tooltip. Mirrors `<UserChip>` in
 * `@/components/UserChip` but is duplicated here because that component
 * is server-only (no `'use client'`) and can't be imported by a client
 * component directly.
 */
function UserChipClient({
  userId,
  resolved,
}: {
  userId: string
  resolved: ResolvedUser | null
}) {
  if (!resolved) {
    return (
      <span
        className="inline-flex items-center font-mono text-xs text-ink whitespace-nowrap"
        title={userId}
      >
        {userId}
      </span>
    )
  }
  const label = resolved.displayName || resolved.username
  return (
    <span
      className="inline-flex items-center gap-1.5 align-middle whitespace-nowrap"
      title={`${userId} · @${resolved.username}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={resolved.avatarUrl}
        alt=""
        width={24}
        height={24}
        className="h-6 w-6 rounded-full border border-line"
        loading="lazy"
        referrerPolicy="no-referrer"
      />
      <span className="text-sm text-ink">@{label}</span>
    </span>
  )
}

function StatusBadge({ status }: { status: Status }) {
  if (status === 'live') {
    return (
      <span className="inline-flex items-center gap-2 rounded-full bg-bg-card2 border border-line px-3 py-1 text-xs">
        <span className="w-2 h-2 rounded-full bg-ok" /> Live
      </span>
    )
  }
  if (status === 'reconnecting') {
    return (
      <span className="inline-flex items-center gap-2 rounded-full bg-bg-card2 border border-line px-3 py-1 text-xs">
        <span className="w-2 h-2 rounded-full bg-err" /> Reconnecting…
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-bg-card2 border border-line px-3 py-1 text-xs">
      <span className="w-2 h-2 rounded-full bg-warn" /> Connecting…
    </span>
  )
}

function ChannelCard({
  channel,
  now,
  resolved,
  onMutated,
}: {
  channel: Channel
  now: number
  resolved: Map<string, ResolvedUser>
  onMutated: () => void
}) {
  const effectiveOwner = channel.actingOwnerUserId ?? channel.ownerUserId
  return (
    <article className="rounded-2xl border border-line bg-bg-card p-5 flex flex-col gap-4">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex flex-col gap-1 min-w-0">
          <h2 className="text-lg font-semibold truncate">{channel.name}</h2>
          <div className="text-xs text-ink-dim font-mono truncate">
            vc {channel.voiceChannelId}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {channel.locked && (
            <span className="rounded-full bg-bg-card2 border border-line px-2.5 py-0.5 text-xs">
              Locked
            </span>
          )}
          {channel.hidden && (
            <span className="rounded-full bg-bg-card2 border border-line px-2.5 py-0.5 text-xs">
              Hidden
            </span>
          )}
          <span className="rounded-full bg-bg-card2 border border-line px-2.5 py-0.5 text-xs">
            {channel.members.length} member{channel.members.length === 1 ? '' : 's'}
          </span>
          {channel.canControl && (
            <VoiceControls
              voiceChannelId={channel.voiceChannelId}
              currentName={channel.name}
              ownerUserId={channel.ownerUserId}
              hostUserIds={channel.hostUserIds}
              members={channel.members}
              locked={channel.locked}
              hidden={channel.hidden}
              onMutated={onMutated}
              resolved={resolved}
            />
          )}
        </div>
      </header>

      <div className="flex flex-col gap-1 text-sm">
        <div className="flex gap-2 items-center">
          <span className="text-xs uppercase tracking-wider text-ink-dim">
            {channel.actingOwnerUserId ? 'Acting owner' : 'Owner'}
          </span>
          {effectiveOwner ? (
            <UserChipClient
              userId={effectiveOwner}
              resolved={resolved.get(effectiveOwner) ?? null}
            />
          ) : (
            <span className="text-ink-dim">—</span>
          )}
        </div>
        {channel.actingOwnerUserId && (
          <div className="flex gap-2 items-center">
            <span className="text-xs uppercase tracking-wider text-ink-dim">
              Original
            </span>
            <UserChipClient
              userId={channel.ownerUserId}
              resolved={resolved.get(channel.ownerUserId) ?? null}
            />
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <div className="text-xs uppercase tracking-wider text-ink-dim">
          Members
        </div>
        {channel.members.length === 0 ? (
          <div className="text-ink-dim text-sm">(empty)</div>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {channel.members.map((m) => (
              <li
                key={m.userId}
                className="flex items-center justify-between gap-3 text-sm"
              >
                <UserChipClient
                  userId={m.userId}
                  resolved={resolved.get(m.userId) ?? null}
                />
                <span className="text-ink-dim text-xs whitespace-nowrap">
                  joined {relativeTime(m.joinedAt, now)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </article>
  )
}

'use client'

/**
 * Client island for /squishy/self-assign-roles.
 *
 * Surfaces:
 *   1. Channel picker — sets the board's destination channel.
 *   2. Add entry — role picker (with auto-join roles grouped first) or game
 *      picker (games not already added).
 *   3. Entry list — kind badge, resolved name, enabled toggle, posted state,
 *      move up/down, remove.
 *   4. Publish / Refresh button — triggers selfassign.publish and surfaces
 *      {posted, removed} or a 502 error string in an inline banner.
 *
 * All mutations go through bespoke fetch + CSRF (mirroring
 * CreateReactionRoleForm in RolesWriteUI.tsx). router.refresh() after every
 * successful mutation so the server component re-runs its DB loaders.
 */
import { useRouter } from 'next/navigation'
import { useCallback, useState } from 'react'
import { ChannelPicker } from '@/components/pickers/ChannelPicker'
import { RolePicker } from '@/components/pickers/RolePicker'

// ── Shared CSS tokens (mirror RolesWriteUI) ──────────────────────────────────

const inputCls =
  'w-full rounded-md border border-line bg-bg-card2 px-2 py-1.5 text-sm placeholder:text-ink-dim/50 focus:outline-none focus:ring-1 focus:ring-accent'
const labelCls = 'text-[11px] uppercase tracking-wider text-ink-dim'
const btnPrimary =
  'inline-flex items-center px-3 py-1.5 text-sm rounded-lg border border-line bg-bg-card2 text-ink hover:bg-bg-card2/70 transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
const btnDanger =
  'inline-flex items-center px-2 py-1 text-xs rounded-md border border-err/40 bg-err/10 text-err hover:bg-err/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
const btnGhost =
  'inline-flex items-center px-1.5 py-0.5 text-xs rounded border border-line bg-transparent text-ink-dim hover:text-ink hover:bg-bg-card2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed'

// ── CSRF helper (mirrors CreateReactionRoleForm) ─────────────────────────────

let _csrf: string | null = null
async function getOrFetchCsrf(): Promise<string> {
  if (_csrf) return _csrf
  const res = await fetch('/api/csrf', { credentials: 'same-origin' })
  const body = (await res.json()) as { token?: string }
  _csrf = body.token ?? ''
  return _csrf
}

function resetCsrf() {
  _csrf = null
}

// ── Types (serialisable props passed from the server component) ──────────────

type Entry = {
  id: string
  kind: string
  refId: string
  label: string | null
  description: string | null
  emoji: string | null
  sortOrder: number
  enabled: boolean
  postedChannelId: string | null
  postedMessageId: string | null
  createdAt: Date
}

type Game = { id: string; name: string }
type AutoJoinRole = { roleId: string }

type Props = {
  entries: Entry[] | null
  games: Game[]
  autoJoinRoles: AutoJoinRole[]
  channelId: string | null
}

// ── Sub-components ───────────────────────────────────────────────────────────

function ErrorBanner({ msg }: { msg: string }) {
  return (
    <div
      role="alert"
      className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200"
    >
      {msg}
    </div>
  )
}

function SuccessBanner({ msg }: { msg: string }) {
  return (
    <div
      role="status"
      className="rounded-md border border-green-500/40 bg-green-500/10 px-3 py-2 text-sm text-green-200"
    >
      {msg}
    </div>
  )
}

// ── Channel picker section ───────────────────────────────────────────────────

function ChannelSection({
  currentChannelId,
}: {
  currentChannelId: string | null
}) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [value, setValue] = useState(currentChannelId ?? '')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const save = useCallback(async () => {
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const token = await getOrFetchCsrf()
      const res = await fetch('/api/squishy/self-assign-roles/channel', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': token,
        },
        credentials: 'same-origin',
        body: JSON.stringify({ channelId: value.trim() || null }),
      })
      let parsed: unknown = null
      try { parsed = await res.json() } catch { /* ignore */ }
      if (!res.ok) {
        if (res.status === 403) resetCsrf()
        const msg =
          typeof parsed === 'object' && parsed && 'error' in parsed
            ? String((parsed as { error: unknown }).error)
            : `Request failed (${res.status})`
        setError(msg)
        return
      }
      setSuccess('Channel saved.')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setSaving(false)
    }
  }, [value, router])

  return (
    <div className="rounded-xl border border-line bg-bg-card p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Board channel</h3>
        <span className="text-[11px] text-ink-dim">sudo · audit-logged</span>
      </div>
      <p className="text-[11px] text-ink-dim">
        The text channel where the self-assign board messages are posted.
        {currentChannelId && (
          <>
            {' '}Current:{' '}
            <code className="font-mono">{currentChannelId}</code>.
          </>
        )}
      </p>
      {error && <ErrorBanner msg={error} />}
      {success && <SuccessBanner msg={success} />}
      <fieldset disabled={saving} className="contents">
        <div className="flex flex-col gap-1">
          <label className={labelCls} htmlFor="sa-channel">
            Channel
          </label>
          <ChannelPicker
            id="sa-channel"
            name="channelId"
            types={['text', 'announcement']}
            value={value}
            onChange={setValue}
            allowNone
          />
        </div>
        <div>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className={btnPrimary}
          >
            {saving ? 'Saving…' : 'Save channel'}
          </button>
        </div>
      </fieldset>
    </div>
  )
}

// ── Add entry section ────────────────────────────────────────────────────────

function AddEntrySection({
  games,
  autoJoinRoles,
  existingIds,
}: {
  games: Game[]
  autoJoinRoles: AutoJoinRole[]
  existingIds: Set<string>
}) {
  const router = useRouter()
  const [kind, setKind] = useState<'role' | 'game'>('role')
  const [refId, setRefId] = useState('')
  const [label, setLabel] = useState('')
  const [description, setDescription] = useState('')
  const [emoji, setEmoji] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Games not yet on the board.
  const availableGames = games.filter((g) => !existingIds.has(g.id))
  // Auto-join role IDs already on the board.
  const autoJoinRoleIds = new Set(autoJoinRoles.map((r) => r.roleId))

  const onSubmit = useCallback(async () => {
    setError(null)
    if (!refId.trim()) {
      setError('Select a role or game to add.')
      return
    }
    setSubmitting(true)
    try {
      const token = await getOrFetchCsrf()
      const payload = {
        kind,
        refId: refId.trim(),
        label: label.trim() || null,
        description: description.trim() || null,
        emoji: emoji.trim() || null,
      }
      const res = await fetch('/api/squishy/self-assign-roles', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': token,
        },
        credentials: 'same-origin',
        body: JSON.stringify(payload),
      })
      let parsed: unknown = null
      try { parsed = await res.json() } catch { /* ignore */ }
      if (!res.ok) {
        if (res.status === 403) resetCsrf()
        const msg =
          typeof parsed === 'object' && parsed && 'error' in parsed
            ? String((parsed as { error: unknown }).error)
            : `Request failed (${res.status})`
        setError(msg)
        return
      }
      // Reset form
      setRefId('')
      setLabel('')
      setDescription('')
      setEmoji('')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setSubmitting(false)
    }
  }, [kind, refId, label, description, emoji, router])

  return (
    <div className="rounded-xl border border-line bg-bg-card p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Add entry</h3>
        <span className="text-[11px] text-ink-dim">sudo · audit-logged</span>
      </div>
      {error && <ErrorBanner msg={error} />}
      <fieldset disabled={submitting} className="contents">
        {/* Kind selector */}
        <div className="flex flex-col gap-1">
          <span className={labelCls}>Kind</span>
          <div className="flex gap-3">
            <label className="flex items-center gap-1.5 text-sm cursor-pointer">
              <input
                type="radio"
                name="sa-kind"
                value="role"
                checked={kind === 'role'}
                onChange={() => { setKind('role'); setRefId('') }}
              />
              Role
            </label>
            <label className="flex items-center gap-1.5 text-sm cursor-pointer">
              <input
                type="radio"
                name="sa-kind"
                value="game"
                checked={kind === 'game'}
                onChange={() => { setKind('game'); setRefId('') }}
              />
              Game
            </label>
          </div>
        </div>

        {/* Role picker with auto-join highlight */}
        {kind === 'role' && (
          <div className="flex flex-col gap-1">
            <label className={labelCls} htmlFor="sa-refId-role">
              Role
            </label>
            <RolePicker
              id="sa-refId-role"
              name="refId-role"
              value={refId}
              onChange={setRefId}
              allowNone
            />
            {autoJoinRoleIds.size > 0 && (
              <div className="mt-1 flex flex-col gap-1">
                <span className={labelCls}>Quick-add from auto-join roles</span>
                <div className="flex flex-wrap gap-1.5">
                  {autoJoinRoles
                    .filter((r) => !existingIds.has(r.roleId))
                    .map((r) => (
                      <button
                        key={r.roleId}
                        type="button"
                        onClick={() => setRefId(r.roleId)}
                        className={`${btnGhost} ${refId === r.roleId ? 'border-accent text-accent' : ''}`}
                      >
                        <code className="font-mono text-[10px]">{r.roleId}</code>
                      </button>
                    ))}
                </div>
                <p className="text-[11px] text-ink-dim">
                  These roles are already in your auto-join list. Click one to
                  pre-fill the picker above.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Game picker */}
        {kind === 'game' && (
          <div className="flex flex-col gap-1">
            <label className={labelCls} htmlFor="sa-refId-game">
              Game
            </label>
            {availableGames.length === 0 ? (
              <p className="text-[11px] text-ink-dim">
                All configured games are already on the board.
              </p>
            ) : (
              <select
                id="sa-refId-game"
                value={refId}
                onChange={(e) => setRefId(e.target.value)}
                className={inputCls}
              >
                <option value="">— Select a game —</option>
                {availableGames.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}

        {/* Optional overrides */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <div className="flex flex-col gap-1">
            <label className={labelCls} htmlFor="sa-label">
              Label override
            </label>
            <input
              id="sa-label"
              type="text"
              maxLength={100}
              placeholder="(defaults to role/game name)"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className={inputCls}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className={labelCls} htmlFor="sa-description">
              Description override
            </label>
            <input
              id="sa-description"
              type="text"
              maxLength={100}
              placeholder="(optional extra line)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className={inputCls}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className={labelCls} htmlFor="sa-emoji">
              Button emoji
            </label>
            <input
              id="sa-emoji"
              type="text"
              maxLength={100}
              placeholder="🎮 or <:name:id>"
              value={emoji}
              onChange={(e) => setEmoji(e.target.value)}
              className={inputCls}
            />
          </div>
        </div>

        <div>
          <button
            type="button"
            onClick={onSubmit}
            disabled={submitting || !refId}
            className={btnPrimary}
          >
            {submitting ? 'Adding…' : 'Add entry'}
          </button>
        </div>
      </fieldset>
    </div>
  )
}

// ── Entry row ────────────────────────────────────────────────────────────────

function EntryRow({
  entry,
  index,
  total,
  games,
  onMove,
  onToggle,
  onRemove,
}: {
  entry: Entry
  index: number
  total: number
  games: Game[]
  onMove: (id: string, direction: 'up' | 'down') => void
  onToggle: (id: string, enabled: boolean) => void
  onRemove: (id: string) => void
}) {
  // Resolve a human-readable name for the entry.
  let resolvedName: string
  if (entry.kind === 'game') {
    const game = games.find((g) => g.id === entry.refId)
    resolvedName = entry.label ?? game?.name ?? `game:${entry.refId.slice(0, 8)}`
  } else {
    resolvedName = entry.label ?? `@&${entry.refId}`
  }

  const isPosted = !!entry.postedMessageId

  return (
    <tr className="border-b border-line last:border-b-0">
      <td className="px-3 py-2 w-8 tabular-nums text-ink-dim text-xs text-right">
        {entry.sortOrder}
      </td>
      <td className="px-3 py-2">
        <span
          className={`inline-block text-[10px] uppercase tracking-wider rounded px-1.5 py-0.5 border ${
            entry.kind === 'game'
              ? 'border-accent/40 text-accent'
              : 'border-line text-ink-dim'
          }`}
        >
          {entry.kind}
        </span>
      </td>
      <td className="px-3 py-2 text-sm">
        <div className="font-medium">{resolvedName}</div>
        {entry.emoji && (
          <div className="text-[11px] text-ink-dim">{entry.emoji}</div>
        )}
        {entry.description && (
          <div className="text-[11px] text-ink-dim truncate max-w-xs" title={entry.description}>
            {entry.description}
          </div>
        )}
      </td>
      <td className="px-3 py-2 whitespace-nowrap">
        <span
          className={`inline-block text-[10px] uppercase tracking-wider rounded px-1.5 py-0.5 border ${
            isPosted
              ? 'border-green-500/40 text-green-400'
              : 'border-line text-ink-dim'
          }`}
        >
          {isPosted ? 'posted' : 'not posted'}
        </span>
      </td>
      <td className="px-3 py-2">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={entry.enabled}
            onChange={(e) => onToggle(entry.id, e.target.checked)}
            className="rounded"
          />
          <span className="text-xs text-ink-dim">
            {entry.enabled ? 'enabled' : 'disabled'}
          </span>
        </label>
      </td>
      <td className="px-3 py-2 text-right whitespace-nowrap">
        <div className="inline-flex items-center gap-1">
          <button
            type="button"
            onClick={() => onMove(entry.id, 'up')}
            disabled={index === 0}
            className={btnGhost}
            title="Move up"
            aria-label="Move entry up"
          >
            ↑
          </button>
          <button
            type="button"
            onClick={() => onMove(entry.id, 'down')}
            disabled={index === total - 1}
            className={btnGhost}
            title="Move down"
            aria-label="Move entry down"
          >
            ↓
          </button>
          <button
            type="button"
            onClick={() => onRemove(entry.id)}
            className={btnDanger}
            title="Remove entry"
            aria-label="Remove entry"
          >
            Remove
          </button>
        </div>
      </td>
    </tr>
  )
}

// ── Publish section ──────────────────────────────────────────────────────────

function PublishSection() {
  const router = useRouter()
  const [publishing, setPublishing] = useState(false)
  const [banner, setBanner] = useState<
    { type: 'ok'; msg: string } | { type: 'err'; msg: string } | null
  >(null)

  const onPublish = useCallback(async () => {
    setPublishing(true)
    setBanner(null)
    try {
      const token = await getOrFetchCsrf()
      const res = await fetch('/api/squishy/self-assign-roles/publish', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': token,
        },
        credentials: 'same-origin',
        body: JSON.stringify({}),
      })
      let parsed: unknown = null
      try { parsed = await res.json() } catch { /* ignore */ }
      if (!res.ok) {
        if (res.status === 403) resetCsrf()
        const msg =
          typeof parsed === 'object' && parsed && 'error' in parsed
            ? String((parsed as { error: unknown }).error)
            : `Publish failed (${res.status})`
        setBanner({ type: 'err', msg })
        return
      }
      const d = parsed as { posted?: number; removed?: number }
      setBanner({
        type: 'ok',
        msg: `Published — ${d.posted ?? 0} posted, ${d.removed ?? 0} removed.`,
      })
      router.refresh()
    } catch (err) {
      setBanner({
        type: 'err',
        msg: err instanceof Error ? err.message : 'Network error',
      })
    } finally {
      setPublishing(false)
    }
  }, [router])

  return (
    <div className="rounded-xl border border-line bg-bg-card p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <h3 className="text-sm font-medium">Publish / Refresh board</h3>
          <p className="text-[11px] text-ink-dim">
            Posts or updates each enabled entry in the configured channel.
            Deletes messages for disabled or removed entries. Sudo only.
          </p>
        </div>
        <button
          type="button"
          onClick={onPublish}
          disabled={publishing}
          className={btnPrimary}
        >
          {publishing ? 'Publishing…' : 'Publish'}
        </button>
      </div>
      {banner && (
        banner.type === 'ok'
          ? <SuccessBanner msg={banner.msg} />
          : <ErrorBanner msg={banner.msg} />
      )}
    </div>
  )
}

// ── Main component ───────────────────────────────────────────────────────────

export function SelfAssignWriteUI({
  entries,
  games,
  autoJoinRoles,
  channelId,
}: Props) {
  const router = useRouter()

  // Local ordered list of entries (mirrors DB, updated optimistically on reorder).
  const [localEntries, setLocalEntries] = useState<Entry[]>(
    entries ?? [],
  )
  const [mutating, setMutating] = useState<string | null>(null) // entry id being mutated
  const [globalError, setGlobalError] = useState<string | null>(null)

  // Set of refIds already on the board (to filter out duplicates in add picker).
  const existingIds = new Set(localEntries.map((e) => e.refId))

  // Generic mutation wrapper: sets the mutating id, catches errors, resets on done.
  // The caller supplies a pre-built fetch call (with CSRF token already in headers).
  const doMutation = useCallback(
    async (
      entryId: string,
      fn: (token: string) => Promise<Response>,
    ): Promise<boolean> => {
      setMutating(entryId)
      setGlobalError(null)
      try {
        const token = await getOrFetchCsrf()
        const res = await fn(token)
        let parsed: unknown = null
        try { parsed = await res.json() } catch { /* ignore */ }
        if (!res.ok) {
          if (res.status === 403) resetCsrf()
          const msg =
            typeof parsed === 'object' && parsed && 'error' in parsed
              ? String((parsed as { error: unknown }).error)
              : `Request failed (${res.status})`
          setGlobalError(msg)
          return false
        }
        return true
      } catch (err) {
        setGlobalError(err instanceof Error ? err.message : 'Network error')
        return false
      } finally {
        setMutating(null)
      }
    },
    [],
  )

  const onToggle = useCallback(
    async (id: string, enabled: boolean) => {
      // Optimistic update
      setLocalEntries((prev) =>
        prev.map((e) => (e.id === id ? { ...e, enabled } : e)),
      )
      const ok = await doMutation(id, (token) =>
        fetch(`/api/squishy/self-assign-roles/${id}`, {
          method: 'PATCH',
          headers: {
            'content-type': 'application/json',
            'x-csrf-token': token,
          },
          credentials: 'same-origin',
          body: JSON.stringify({ enabled }),
        }),
      )
      if (!ok) {
        // Revert optimistic update on failure
        setLocalEntries((prev) =>
          prev.map((e) => (e.id === id ? { ...e, enabled: !enabled } : e)),
        )
      } else {
        router.refresh()
      }
    },
    [doMutation, router],
  )

  const onRemove = useCallback(
    async (id: string) => {
      if (!window.confirm('Remove this entry from the board?')) return
      const ok = await doMutation(id, (token) =>
        fetch(`/api/squishy/self-assign-roles/${id}`, {
          method: 'DELETE',
          headers: { 'x-csrf-token': token },
          credentials: 'same-origin',
        }),
      )
      if (ok) {
        setLocalEntries((prev) => prev.filter((e) => e.id !== id))
        router.refresh()
      }
    },
    [doMutation, router],
  )

  const onMove = useCallback(
    async (id: string, direction: 'up' | 'down') => {
      const idx = localEntries.findIndex((e) => e.id === id)
      if (idx === -1) return
      const newIdx = direction === 'up' ? idx - 1 : idx + 1
      if (newIdx < 0 || newIdx >= localEntries.length) return

      // Optimistic reorder
      const next = [...localEntries]
      const [moved] = next.splice(idx, 1)
      next.splice(newIdx, 0, moved)
      setLocalEntries(next)

      const ids = next.map((e) => e.id)
      // Capture the pre-reorder snapshot before the state update for rollback.
      const prev = localEntries
      const ok = await doMutation(id, (token) =>
        fetch('/api/squishy/self-assign-roles/reorder', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-csrf-token': token,
          },
          credentials: 'same-origin',
          body: JSON.stringify({ ids }),
        }),
      )
      if (!ok) {
        // Revert on failure
        setLocalEntries(prev)
      } else {
        router.refresh()
      }
    },
    [localEntries, doMutation, router],
  )

  if (entries === null) {
    return (
      <div className="rounded-xl border border-line bg-bg-card p-6 text-sm text-err">
        Failed to load self-assign entries — the SquishyBot database isn&apos;t
        reachable from the panel right now. Check{' '}
        <code className="font-mono text-xs">SQUISHY_DATABASE_URL</code> and
        container networking, then refresh.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <ChannelSection currentChannelId={channelId} />

      <AddEntrySection
        games={games}
        autoJoinRoles={autoJoinRoles}
        existingIds={existingIds}
      />

      {globalError && <ErrorBanner msg={globalError} />}

      {localEntries.length === 0 ? (
        <div className="rounded-xl border border-line bg-bg-card p-6 text-sm text-ink-dim">
          No self-assign entries yet. Add a role or game via the form above.
          Once entries are configured, click <strong>Publish</strong> to post
          them to the board channel.
        </div>
      ) : (
        <div className="rounded-xl border border-line bg-bg-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-bg-card2 text-xs uppercase tracking-wider text-ink-dim">
                <tr>
                  <th className="px-3 py-2 font-medium w-8">#</th>
                  <th className="px-3 py-2 font-medium">Kind</th>
                  <th className="px-3 py-2 font-medium">Entry</th>
                  <th className="px-3 py-2 font-medium">Posted</th>
                  <th className="px-3 py-2 font-medium">Enabled</th>
                  <th className="px-3 py-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {localEntries.map((entry, i) => (
                  <EntryRow
                    key={entry.id}
                    entry={entry}
                    index={i}
                    total={localEntries.length}
                    games={games}
                    onMove={mutating ? () => {} : onMove}
                    onToggle={mutating ? () => {} : onToggle}
                    onRemove={mutating ? () => {} : onRemove}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <PublishSection />
    </div>
  )
}

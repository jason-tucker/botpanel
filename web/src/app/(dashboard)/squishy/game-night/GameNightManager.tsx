'use client'

/**
 * Client UI for /squishy/game-night.
 *
 * Wraps the reusable <MessageDesigner> with game-night specifics: target
 * channel, event time (feeds {{when}}), notes, an RSVP toggle, and "post now /
 * schedule" controls. Also lists existing posts with send-now / edit / delete.
 *
 * Writes go through a small CSRF-aware fetch helper (the spec is a nested
 * object, so <ServerForm>'s flat-field model doesn't fit); after each write we
 * router.refresh() to re-read the server table.
 */
import { useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChannelPicker } from '@/components/pickers/ChannelPicker'
import { MessageDesigner } from '@/components/msgeditor/MessageDesigner'
import type { PreviewButton } from '@/components/msgeditor/MessagePreview'
import { gameNightDefaultSpec, gameNightVariables } from '@/lib/msgspec/defaults'
import { parseMessageSpec, type MessageSpec } from '@/lib/msgspec/schema'
import { previewContext } from '@/lib/msgspec/variables'

export type ScheduledPostDTO = {
  id: string
  title: string
  channelId: string
  status: string
  kind: string
  enableRsvp: boolean
  fireAt: string | null
  postedAt: string | null
  messageId: string | null
  error: string | null
  eventAt: string | null
  notes: string
  steam: string
  spec: MessageSpec
  createdAt: string
}

const inputCls =
  'w-full rounded-md border border-line bg-bg-card2 px-2 py-1.5 text-sm text-ink placeholder:text-ink-dim/50 focus:outline-none focus:ring-1 focus:ring-accent'
const labelCls = 'text-[11px] uppercase tracking-wider text-ink-dim'
const btnPrimary =
  'inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg border border-accent/50 bg-accent/15 text-accent hover:bg-accent/25 transition-colors disabled:opacity-40'
const btnGhost =
  'inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg border border-line bg-bg-card2 text-ink-dim hover:text-ink hover:bg-bg-card2/70 transition-colors disabled:opacity-40'
const btnDanger =
  'inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md border border-err/40 bg-err/10 text-err hover:bg-err/20 transition-colors disabled:opacity-40'

const RSVP_PREVIEW: PreviewButton[][] = [
  [
    { label: 'Joining', emoji: '✅', style: 'success' },
    { label: 'Might join', emoji: '🤔', style: 'primary' },
    { label: 'Not joining', emoji: '❌', style: 'secondary' },
  ],
  [
    { label: 'I own it', emoji: '👍', style: 'secondary' },
    { label: "I don't own it", emoji: '🛒', style: 'secondary' },
  ],
  [{ label: 'Cancel', emoji: '✖️', style: 'danger' }],
]

// ── datetime-local helpers (local TZ) ──────────────────────────────────────
const pad = (n: number) => String(n).padStart(2, '0')
function toLocalInput(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function defaultEvent(): string {
  const d = new Date(Date.now() + 3 * 3600_000)
  d.setSeconds(0, 0)
  return toLocalInput(d)
}
function localToIso(v: string): string | null {
  if (!v) return null
  const ms = new Date(v).getTime()
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null
}
function localToUnix(v: string): number {
  const ms = new Date(v).getTime()
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : Math.floor(Date.now() / 1000)
}

// ── CSRF-aware JSON fetch (mirrors GamesWriteUI) ────────────────────────────
let cachedCsrf: string | null = null
async function csrf(): Promise<string | null> {
  if (cachedCsrf) return cachedCsrf
  try {
    const r = await fetch('/api/csrf', { credentials: 'same-origin' })
    if (!r.ok) return null
    const b = (await r.json()) as { token?: unknown }
    if (typeof b.token === 'string') return (cachedCsrf = b.token)
  } catch {
    /* ignore */
  }
  return null
}
async function requestJson<T = unknown>(
  url: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  body?: unknown,
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const doFetch = async (token: string | null) =>
    fetch(url, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { 'x-csrf-token': token } : {}) },
      credentials: 'same-origin',
      body: JSON.stringify(body ?? {}),
    })
  let res = await doFetch(await csrf())
  if (res.status === 403) {
    cachedCsrf = null
    res = await doFetch(await csrf())
  }
  let parsed: unknown = null
  try {
    parsed = await res.json()
  } catch {
    /* ignore */
  }
  if (res.ok) return { ok: true, data: parsed as T }
  const err =
    parsed && typeof parsed === 'object' && typeof (parsed as { error?: unknown }).error === 'string'
      ? (parsed as { error: string }).error
      : `Request failed (${res.status})`
  return { ok: false, error: err }
}

function statusBadge(status: string): { cls: string; label: string } {
  switch (status) {
    case 'posted':
      return { cls: 'bg-ok/15 text-ok border-ok/40', label: 'Posted' }
    case 'scheduled':
      return { cls: 'bg-accent/15 text-accent border-accent/40', label: 'Scheduled' }
    case 'posting':
      return { cls: 'bg-warn/15 text-warn border-warn/40', label: 'Posting…' }
    case 'failed':
      return { cls: 'bg-err/15 text-err border-err/40', label: 'Failed' }
    case 'canceled':
      return { cls: 'bg-bg-card2 text-ink-dim border-line', label: 'Canceled' }
    default:
      return { cls: 'bg-bg-card2 text-ink-dim border-line', label: status }
  }
}

function fmt(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString()
}

export function GameNightManager({
  existing,
  rpcConfigured,
  guildConfigured,
}: {
  existing: ScheduledPostDTO[]
  rpcConfigured: boolean
  guildConfigured: boolean
}) {
  const router = useRouter()
  const editorRef = useRef<HTMLDivElement>(null)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [channelId, setChannelId] = useState('')
  const [notes, setNotes] = useState('')
  const [steam, setSteam] = useState('')
  const [eventLocal, setEventLocal] = useState(defaultEvent)
  const [scheduleMode, setScheduleMode] = useState<'now' | 'at'>('at')
  const [fireLocal, setFireLocal] = useState(defaultEvent)
  const [enableRsvp, setEnableRsvp] = useState(true)
  const [spec, setSpec] = useState<MessageSpec>(() => gameNightDefaultSpec())

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const eventUnix = useMemo(() => localToUnix(eventLocal), [eventLocal])
  const vars = useMemo(() => gameNightVariables(eventUnix), [eventUnix])
  const previewCtx = useMemo(() => {
    const ctx = previewContext(vars, { when: eventUnix })
    ctx.values.game = title || 'Game Night'
    ctx.values.notes = notes
    ctx.values.steam = steam
    return ctx
  }, [vars, eventUnix, title, notes, steam])

  function resetEditor() {
    setEditingId(null)
    setTitle('')
    setChannelId('')
    setNotes('')
    setSteam('')
    setEventLocal(defaultEvent())
    setScheduleMode('at')
    setFireLocal(defaultEvent())
    setEnableRsvp(true)
    setSpec(gameNightDefaultSpec())
    setError(null)
    setNotice(null)
  }

  function loadForEdit(row: ScheduledPostDTO) {
    setEditingId(row.id)
    setTitle(row.title)
    setChannelId(row.channelId)
    setNotes(row.notes)
    setSteam(row.steam)
    setEventLocal(row.eventAt ? toLocalInput(new Date(row.eventAt)) : defaultEvent())
    setScheduleMode(row.fireAt ? 'at' : 'now')
    setFireLocal(row.fireAt ? toLocalInput(new Date(row.fireAt)) : defaultEvent())
    setEnableRsvp(row.enableRsvp)
    setSpec(row.spec)
    setError(null)
    setNotice(null)
    editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function validate(): string | null {
    if (!guildConfigured) return 'GUILD_ID is not configured — scheduling is disabled.'
    if (title.trim().length === 0) return 'Add a title (the game name).'
    if (!/^\d{15,25}$/.test(channelId)) return 'Pick a target channel.'
    const parsed = parseMessageSpec(spec)
    if (!parsed.ok) return `Message has a problem: ${parsed.errors[0]}`
    if (scheduleMode === 'at' && !fireLocal) return 'Pick a date/time to schedule, or switch to “post now”.'
    return null
  }

  async function submit() {
    const v = validate()
    if (v) {
      setError(v)
      return
    }
    setBusy(true)
    setError(null)
    setNotice(null)
    const variables = { notes, eventAt: localToIso(eventLocal), steam: steam.trim() }

    if (editingId) {
      const res = await requestJson(`/api/squishy/scheduled-posts/${editingId}`, 'PATCH', {
        title,
        channelId,
        spec,
        variables,
        enableRsvp,
        fireAt: scheduleMode === 'at' ? localToIso(fireLocal) : null,
      })
      setBusy(false)
      if (res.ok) {
        setNotice('Saved changes.')
        resetEditor()
        router.refresh()
      } else {
        setError(res.error)
      }
      return
    }

    const res = await requestJson<{ id: string; sent?: { ok: boolean; error?: string } }>(
      '/api/squishy/scheduled-posts',
      'POST',
      {
        title,
        channelId,
        spec,
        variables,
        enableRsvp,
        fireAt: scheduleMode === 'at' ? localToIso(fireLocal) : null,
        sendNow: scheduleMode === 'now',
      },
    )
    setBusy(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    if (scheduleMode === 'now') {
      const sent = res.data?.sent
      setNotice(sent?.ok ? '✅ Posted to the channel.' : `Saved, but immediate post failed (${sent?.error ?? 'unknown'}). Use “Send now” on the row to retry.`)
    } else {
      setNotice('✅ Scheduled.')
    }
    resetEditor()
    router.refresh()
  }

  async function sendNow(id: string) {
    setBusy(true)
    const res = await requestJson(`/api/squishy/scheduled-posts/${id}/send`, 'POST')
    setBusy(false)
    if (res.ok) {
      setNotice('✅ Posted.')
      router.refresh()
    } else {
      setError(`Send failed: ${res.error}`)
    }
  }

  async function remove(id: string) {
    if (!window.confirm('Delete this post? If it was already posted, the Discord message is removed too.')) return
    setBusy(true)
    const res = await requestJson(`/api/squishy/scheduled-posts/${id}`, 'DELETE')
    setBusy(false)
    if (res.ok) {
      if (editingId === id) resetEditor()
      router.refresh()
    } else {
      setError(`Delete failed: ${res.error}`)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* ── editor card ───────────────────────────────────────────────── */}
      <div ref={editorRef} className="rounded-xl border border-line bg-bg-card p-4 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-ink">{editingId ? 'Edit post' : 'New game-night post'}</h2>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-ink-dim">sudo · audit-logged</span>
            {editingId && (
              <button type="button" className={btnGhost} onClick={resetEditor}>Cancel edit</button>
            )}
          </div>
        </div>

        {!rpcConfigured && (
          <div className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-[12px] text-warn">
            <code className="font-mono">BOTPANEL_RPC_SECRET</code> isn&apos;t set — “Post now” can&apos;t reach the bot. Scheduled posts still fire from the bot&apos;s side.
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label className={labelCls}>Title / game name</label>
            <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Lethal Company" maxLength={120} />
          </div>
          <div className="flex flex-col gap-1">
            <label className={labelCls}>Channel</label>
            <ChannelPicker name="channelId" value={channelId} onChange={setChannelId} types={['text', 'announcement']} allowNone />
          </div>
          <div className="flex flex-col gap-1">
            <label className={labelCls}>Event time — feeds {`{{when}}`}</label>
            <input type="datetime-local" className={inputCls} value={eventLocal} onChange={(e) => setEventLocal(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <label className={labelCls}>Notes — feeds {`{{notes}}`}</label>
            <input className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="optional" maxLength={2000} />
          </div>
          <div className="flex flex-col gap-1 md:col-span-2">
            <label className={labelCls}>Steam link — feeds {`{{steam}}`} (insert anywhere, or use the default 🎮 button)</label>
            <input className={inputCls} value={steam} onChange={(e) => setSteam(e.target.value)} placeholder="https://store.steampowered.com/app/…" maxLength={512} inputMode="url" />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={enableRsvp} onChange={(e) => setEnableRsvp(e.target.checked)} />
            Add RSVP buttons (Joining / Maybe / Out + own-a-copy)
          </label>
        </div>

        {/* the reusable editor */}
        <MessageDesigner
          value={spec}
          onChange={setSpec}
          variables={vars}
          previewCtx={previewCtx}
          appendedRows={enableRsvp ? RSVP_PREVIEW : []}
        />

        {/* schedule controls */}
        <div className="rounded-lg border border-line bg-bg-card2/50 p-3 flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-4">
            <span className={labelCls}>When to post</span>
            <label className="flex items-center gap-1.5 text-sm text-ink">
              <input type="radio" name="when" checked={scheduleMode === 'now'} onChange={() => setScheduleMode('now')} />
              {editingId ? 'No schedule (send manually)' : 'Post now'}
            </label>
            <label className="flex items-center gap-1.5 text-sm text-ink">
              <input type="radio" name="when" checked={scheduleMode === 'at'} onChange={() => setScheduleMode('at')} />
              Schedule for…
            </label>
            {scheduleMode === 'at' && (
              <input type="datetime-local" className={`${inputCls} max-w-[16rem]`} value={fireLocal} onChange={(e) => setFireLocal(e.target.value)} />
            )}
          </div>

          {error && <div className="rounded-md border border-err/40 bg-err/10 px-3 py-2 text-sm text-err">{error}</div>}
          {notice && <div className="rounded-md border border-ok/40 bg-ok/10 px-3 py-2 text-sm text-ok">{notice}</div>}

          <div className="flex items-center gap-2">
            <button type="button" className={btnPrimary} disabled={busy} onClick={submit}>
              {busy ? 'Working…' : editingId ? 'Save changes' : scheduleMode === 'now' ? '📨 Post now' : '🗓️ Schedule post'}
            </button>
            <button type="button" className={btnGhost} disabled={busy} onClick={() => setSpec(gameNightDefaultSpec())} title="Reset the message body to the default template">
              Reset template
            </button>
          </div>
        </div>
      </div>

      {/* ── existing posts ────────────────────────────────────────────── */}
      <div className="rounded-xl border border-line bg-bg-card p-4">
        <h2 className="mb-3 text-sm font-medium text-ink">Scheduled &amp; posted</h2>
        {existing.length === 0 ? (
          <p className="text-sm text-ink-dim">No game-night posts yet.</p>
        ) : (
          <div className="flex flex-col divide-y divide-line">
            {existing.map((row) => {
              const badge = statusBadge(row.status)
              const editable = row.status !== 'posted' && row.status !== 'posting'
              return (
                <div key={row.id} className="flex flex-wrap items-center gap-3 py-2.5">
                  <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${badge.cls}`}>{badge.label}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-ink">{row.title || '(untitled)'}</div>
                    <div className="truncate text-[11px] text-ink-dim">
                      <span className="font-mono">#{row.channelId}</span>
                      {row.status === 'posted'
                        ? <> · posted {fmt(row.postedAt)}</>
                        : row.fireAt
                          ? <> · fires {fmt(row.fireAt)}</>
                          : <> · manual</>}
                      {row.error && <span className="text-err"> · {row.error}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {row.status !== 'posted' && row.status !== 'canceled' && (
                      <button type="button" className={btnGhost} disabled={busy} onClick={() => sendNow(row.id)}>Send now</button>
                    )}
                    {editable && (
                      <button type="button" className={btnGhost} disabled={busy} onClick={() => loadForEdit(row)}>Edit</button>
                    )}
                    <button type="button" className={btnDanger} disabled={busy} onClick={() => remove(row.id)}>Delete</button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

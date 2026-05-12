/**
 * OcStockManager — client-side editable grid for `/otter/oc-stock`.
 *
 * Renders the same card layout as the read-only path but with inline
 * per-card controls (status select / URL edit / Delete) and a top "Add item"
 * form. Writes route through `<ServerForm>` (provided by Wave-6 write-infra)
 * which handles CSRF, method spoofing for PATCH/DELETE, error surfacing, and
 * the `onSuccess` callback. On any successful mutation we call
 * `router.refresh()` so the server component re-renders with the new rows —
 * we don't try to optimistically reconcile the grid in-memory because the
 * mutation set is small (a handful of clicks per session) and trust-the-
 * server keeps us aligned with the audit log.
 *
 * Non-editors never reach this component — the server page renders the
 * read-only fallback for them. The `canEdit` prop is still threaded through
 * defensively so a future refactor that mounts this for everyone wouldn't
 * silently expose write controls.
 */
'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { ServerForm } from '@/lib/forms/ServerForm'

export type OcStockItem = {
  id: string
  name: string
  status: 'in_stock' | 'low_stock' | 'out_of_stock'
  sortOrder: number
  url: string | null
  updatedAt: string
  updatedByDiscordId: string | null
}

type StatusMeta = {
  emoji: string
  ringClass: string
  cardClass: string
  label: string
}

const STATUS_META: Record<OcStockItem['status'], StatusMeta> = {
  in_stock: {
    emoji: '🟢',
    ringClass: 'ring-2 ring-emerald-500/60',
    cardClass: '',
    label: 'In stock',
  },
  low_stock: {
    emoji: '🟠',
    ringClass: 'ring-2 ring-orange-500/60',
    cardClass: '',
    label: 'Low stock',
  },
  out_of_stock: {
    emoji: '🔴',
    ringClass: 'ring-2 ring-red-500/60',
    cardClass: 'opacity-50',
    label: 'Out of stock',
  },
}

function relTime(d: Date): string {
  const diffMs = Date.now() - d.getTime()
  const sec = Math.round(diffMs / 1000)
  if (sec < 5) return 'just now'
  if (sec < 60) return `${sec}s ago`
  const min = Math.round(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.round(hr / 24)
  if (day < 30) return `${day}d ago`
  const mo = Math.round(day / 30)
  if (mo < 12) return `${mo}mo ago`
  const yr = Math.round(mo / 12)
  return `${yr}y ago`
}

function ManageCard({
  row,
  canEdit,
  onChanged,
}: {
  row: OcStockItem
  canEdit: boolean
  onChanged: () => void
}) {
  const meta = STATUS_META[row.status] ?? STATUS_META.in_stock
  const updated = new Date(row.updatedAt)
  const [editingUrl, setEditingUrl] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  return (
    <div
      className={`rounded-2xl bg-bg-card p-4 flex flex-col gap-3 ${meta.ringClass} ${meta.cardClass}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="text-2xl leading-none" aria-label={meta.label} title={meta.label}>
          {meta.emoji}
        </div>
        <div className="text-[10px] uppercase tracking-wider text-ink-dim">
          {meta.label}
        </div>
      </div>

      <div className="font-semibold text-ink break-words">
        {row.url ? (
          <a
            href={row.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-baseline gap-1 hover:underline"
          >
            <span>{row.name}</span>
            <ExternalLink className="w-3.5 h-3.5 shrink-0 self-center" aria-hidden />
          </a>
        ) : (
          <span>{row.name}</span>
        )}
      </div>

      {canEdit && (
        <div className="flex flex-col gap-2 border-t border-line pt-2">
          <ServerForm
            action={`/api/otter/oc-stock/${row.id}`}
            method="PATCH"
            onSuccess={onChanged}
            className="flex items-center gap-2"
          >
            <label className="text-[10px] uppercase tracking-wider text-ink-dim">
              Status
            </label>
            <select
              name="status"
              defaultValue={row.status}
              className="flex-1 rounded-md border border-line bg-bg-card2 text-ink text-xs px-2 py-1"
            >
              <option value="in_stock">In stock</option>
              <option value="low_stock">Low stock</option>
              <option value="out_of_stock">Out of stock</option>
            </select>
            <button
              type="submit"
              className="rounded-md border border-line bg-bg-card2 text-ink text-xs px-2 py-1 hover:bg-bg-card"
            >
              Save
            </button>
          </ServerForm>

          {editingUrl ? (
            <ServerForm
              action={`/api/otter/oc-stock/${row.id}`}
              method="PATCH"
              onSuccess={() => {
                setEditingUrl(false)
                onChanged()
              }}
              className="flex items-center gap-2"
            >
              <input
                name="url"
                type="url"
                defaultValue={row.url ?? ''}
                placeholder="https://…"
                className="flex-1 rounded-md border border-line bg-bg-card2 text-ink text-xs px-2 py-1"
              />
              <button
                type="submit"
                className="rounded-md border border-line bg-bg-card2 text-ink text-xs px-2 py-1 hover:bg-bg-card"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => setEditingUrl(false)}
                className="rounded-md border border-line text-ink-dim text-xs px-2 py-1 hover:text-ink"
              >
                Cancel
              </button>
            </ServerForm>
          ) : (
            <button
              type="button"
              onClick={() => setEditingUrl(true)}
              className="self-start rounded-md border border-line bg-bg-card2 text-ink-dim text-xs px-2 py-1 hover:text-ink"
            >
              {row.url ? 'Edit URL' : 'Add URL'}
            </button>
          )}

          {confirmingDelete ? (
            <ServerForm
              action={`/api/otter/oc-stock/${row.id}`}
              method="DELETE"
              onSuccess={() => {
                setConfirmingDelete(false)
                onChanged()
              }}
              className="flex items-center gap-2"
            >
              <span className="text-xs text-red-400">Delete this item?</span>
              <button
                type="submit"
                className="rounded-md border border-red-500/60 bg-red-500/10 text-red-300 text-xs px-2 py-1 hover:bg-red-500/20"
              >
                Confirm
              </button>
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                className="rounded-md border border-line text-ink-dim text-xs px-2 py-1 hover:text-ink"
              >
                Cancel
              </button>
            </ServerForm>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              className="self-start rounded-md border border-red-500/40 bg-bg-card2 text-red-300 text-xs px-2 py-1 hover:bg-red-500/10"
            >
              Remove
            </button>
          )}
        </div>
      )}

      <div className="mt-auto text-xs text-ink-dim flex flex-col gap-0.5">
        <span title={updated.toISOString()}>Updated {relTime(updated)}</span>
        {row.updatedByDiscordId && (
          <span className="font-mono text-[10px] opacity-70">
            by {row.updatedByDiscordId}
          </span>
        )}
      </div>
    </div>
  )
}

function PostToChannelForm() {
  // Wave 7c-C. Lives below the edit controls — a manager finishes editing
  // items, drops in the destination channel ID, and pushes the live card
  // to Discord via the bot's `oc.stock_post` verb. Success surfaces the
  // resulting Discord message ID (so the operator can spot-check the
  // post or grab it for audit). Failure surfaces the bot's error code
  // verbatim (`channel-not-found`, `not-text-based`, etc.) so it's clear
  // whether the channel is wrong, the bot lacks Send perms, or RPC timed
  // out.
  // ServerForm renders its own red error banner above the form for 4xx /
  // 5xx responses (including the verbatim `error` code from the route's
  // `{error: 'channel-not-found' | 'not-text-based' | ...}` envelope), so
  // we only need to drive the green "posted" strip locally.
  const [posted, setPosted] = useState<{ messageId: string; channelId: string } | null>(null)

  return (
    <section className="rounded-2xl border border-line bg-bg-card p-4 flex flex-col gap-3">
      <div className="text-xs uppercase tracking-wider text-ink-dim">
        Post to channel
      </div>
      <p className="text-sm text-ink-dim">
        Posts the live OC stock card to the Discord channel below. Any OC role
        member can post — the bot must have <code className="font-mono text-xs">Send Messages</code> in the channel.
      </p>
      <ServerForm
        action="/api/otter/oc-stock/post"
        method="POST"
        onSuccess={(data) => {
          if (data && typeof data === 'object') {
            const o = data as Record<string, unknown>
            const messageId = typeof o.messageId === 'string' ? o.messageId : ''
            const channelId = typeof o.channelId === 'string' ? o.channelId : ''
            if (messageId && channelId) {
              setPosted({ messageId, channelId })
              return
            }
          }
          setPosted(null)
        }}
        className="flex flex-col sm:flex-row sm:items-end gap-2"
      >
        <label className="flex-1 flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider text-ink-dim">
            Channel ID (snowflake)
          </span>
          <input
            name="channelId"
            required
            pattern="\d{17,20}"
            placeholder="1234567890123456789"
            inputMode="numeric"
            className="rounded-md border border-line bg-bg-card2 text-ink text-sm px-2 py-1.5 font-mono"
          />
        </label>
        <button
          type="submit"
          className="rounded-md border border-line bg-bg-card2 text-ink text-sm px-3 py-1.5 hover:bg-bg-card"
        >
          Post to channel
        </button>
      </ServerForm>

      {posted && (
        <div
          role="status"
          className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200 flex flex-col gap-0.5"
        >
          <span>Posted to Discord.</span>
          <span className="font-mono text-[11px] opacity-80">
            messageId: {posted.messageId} · channelId: {posted.channelId}
          </span>
        </div>
      )}
    </section>
  )
}

export function OcStockManager({
  items,
  canEdit,
}: {
  items: OcStockItem[]
  canEdit: boolean
}) {
  const router = useRouter()
  const onChanged = () => router.refresh()

  return (
    <div className="flex flex-col gap-4">
      {canEdit && (
        <section className="rounded-2xl border border-line bg-bg-card p-4">
          <div className="text-xs uppercase tracking-wider text-ink-dim mb-2">
            Add item
          </div>
          <ServerForm
            action="/api/otter/oc-stock"
            method="POST"
            onSuccess={onChanged}
            resetOnSuccess
            className="flex flex-col sm:flex-row sm:items-end gap-2"
          >
            <label className="flex-1 flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wider text-ink-dim">
                Name
              </span>
              <input
                name="name"
                required
                maxLength={200}
                placeholder="OC item name"
                className="rounded-md border border-line bg-bg-card2 text-ink text-sm px-2 py-1.5"
              />
            </label>
            <label className="flex-1 flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wider text-ink-dim">
                URL (optional)
              </span>
              <input
                name="url"
                type="url"
                placeholder="https://…"
                className="rounded-md border border-line bg-bg-card2 text-ink text-sm px-2 py-1.5"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wider text-ink-dim">
                Status
              </span>
              <select
                name="status"
                defaultValue="in_stock"
                className="rounded-md border border-line bg-bg-card2 text-ink text-sm px-2 py-1.5"
              >
                <option value="in_stock">In stock</option>
                <option value="low_stock">Low stock</option>
                <option value="out_of_stock">Out of stock</option>
              </select>
            </label>
            <button
              type="submit"
              className="rounded-md border border-line bg-bg-card2 text-ink text-sm px-3 py-1.5 hover:bg-bg-card"
            >
              Add
            </button>
          </ServerForm>
        </section>
      )}

      {items.length === 0 ? (
        <section className="rounded-2xl border border-line bg-bg-card p-6">
          <div className="text-xs uppercase tracking-wider text-ink-dim mb-2">
            Empty
          </div>
          <p className="text-ink">No items configured yet.</p>
        </section>
      ) : (
        <section className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {items.map((row) => (
            <ManageCard
              key={row.id}
              row={row}
              canEdit={canEdit}
              onChanged={onChanged}
            />
          ))}
        </section>
      )}

      {canEdit && <PostToChannelForm />}
    </div>
  )
}

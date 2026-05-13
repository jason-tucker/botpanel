'use client'

/**
 * `<BusinessMessageEditor>` — generic editor for a list of editable card
 * bodies. Used by both `/otter/caked` and `/otter/oc-stock` to surface
 * the `business_messages` rows the bot's `business_messages.list` RPC
 * verb returned.
 *
 * Layout per key:
 *   - Label (friendly name) + "Default" pill when no override exists.
 *   - Textarea prefilled with the current body (override OR default).
 *   - Save → POST to `updateUrl` with `{messageKey, body}`.
 *   - Reset (only when `isOverride`) → POST to `resetUrl` with
 *     `{messageKey}`. Confirmation prompt before sending.
 *
 * After any successful save/reset we `router.refresh()` so the server
 * component re-renders with the latest list (the bot's RPC reply gives
 * us back the new row but the page-level data fetch is the source of
 * truth — refresh keeps the override/default flag honest).
 */
import { useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { ServerForm } from '@/lib/forms/ServerForm'

export interface MessageItem {
  key: string
  label: string
  body: string
  defaultBody: string
  isOverride: boolean
  updatedAt: string | null
  updatedBy: string | null
}

interface ReplyOk { ok: true; data: unknown }
interface ReplyErr { ok: false; error: string; details?: unknown }
type Reply = ReplyOk | ReplyErr
interface ApiResponse { reply?: Reply }

interface Status { ok: boolean; text: string }

function StatusBanner({ status }: { status: Status | null }): ReactNode {
  if (!status) return null
  const cls = status.ok
    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
    : 'border-amber-500/40 bg-amber-500/10 text-amber-200'
  return (
    <div role="status" className={`rounded-md border px-3 py-2 text-xs ${cls}`}>
      {status.text}
    </div>
  )
}

function MessageCard({
  item,
  updateUrl,
  resetUrl,
}: {
  item: MessageItem
  updateUrl: string
  resetUrl: string
}): React.JSX.Element {
  const router = useRouter()
  const [status, setStatus] = useState<Status | null>(null)
  // Local copy so the user can revert before saving without forcing a
  // page refresh. Reset to server state on every prop change (post-refresh).
  const [draft, setDraft] = useState(item.body)

  const handleSuccess = (kind: 'save' | 'reset') => (data: unknown): void => {
    const reply = (data as ApiResponse | null)?.reply
    if (!reply) {
      setStatus({ ok: false, text: 'No reply from bot.' })
      return
    }
    if (reply.ok) {
      setStatus({
        ok: true,
        text: kind === 'save' ? 'Saved.' : 'Reset to default.',
      })
      router.refresh()
    } else {
      const detail = typeof reply.details === 'string' ? `: ${reply.details}` : ''
      setStatus({ ok: false, text: `Bot returned ${reply.error}${detail}` })
    }
  }

  const updated = item.updatedAt ? new Date(item.updatedAt) : null

  return (
    <section className="rounded-2xl border border-line bg-bg-card p-4 flex flex-col gap-3">
      <header className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-sm font-semibold text-ink">{item.label}</h3>
          <code className="font-mono text-[10px] text-ink-dim">{item.key}</code>
          {!item.isOverride && (
            <span
              className="inline-flex items-center rounded-md border border-line bg-bg-card2/40 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-ink-dim"
              title="No override saved — /caked or /oc renders the bot's hardcoded default."
            >
              Default
            </span>
          )}
        </div>
        {updated && (
          <span className="text-[10px] text-ink-dim" title={updated.toISOString()}>
            Updated {updated.toLocaleString()}
          </span>
        )}
      </header>

      <ServerForm
        action={updateUrl}
        method="POST"
        onSuccess={handleSuccess('save')}
        className="flex flex-col gap-2"
      >
        <input type="hidden" name="messageKey" value={item.key} />
        <textarea
          name="body"
          required
          maxLength={4000}
          rows={8}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="rounded-md border border-line bg-bg-card2/40 px-2.5 py-1.5 text-sm text-ink font-mono focus:outline-none focus:ring-2 focus:ring-accent/50 resize-y"
        />
        <div className="flex items-center justify-between gap-2 text-[10px] text-ink-dim">
          <span>{draft.length} / 4000 chars</span>
          {item.isOverride && draft !== item.body && (
            <span className="text-warn">Unsaved changes</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="submit"
            className="rounded-md border border-line bg-bg-card2/80 hover:bg-bg-card2 text-ink text-sm font-medium px-3 py-1.5"
          >
            Save
          </button>
        </div>

        <StatusBanner status={status} />
      </ServerForm>

      {item.isOverride && (
        <ServerForm
          action={resetUrl}
          method="POST"
          confirm={`Reset "${item.label}" to the bot default? This deletes your saved override.`}
          onSuccess={handleSuccess('reset')}
          className="flex flex-col gap-2"
        >
          <input type="hidden" name="messageKey" value={item.key} />
          <div className="flex items-center gap-2">
            <button
              type="submit"
              className="rounded-md border border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20 text-amber-200 text-xs font-medium px-2.5 py-1.5"
            >
              Reset to default
            </button>
          </div>
        </ServerForm>
      )}
    </section>
  )
}

export function BusinessMessageEditor({
  items,
  updateUrl,
  resetUrl,
  title = 'Edit message content',
  description,
}: {
  items: MessageItem[]
  updateUrl: string
  resetUrl: string
  title?: string
  description?: string
}): React.JSX.Element {
  if (items.length === 0) {
    return (
      <section className="rounded-2xl border border-line bg-bg-card p-4">
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="text-sm text-ink-dim mt-2">No editable fields configured for this business.</p>
      </section>
    )
  }
  return (
    <section className="flex flex-col gap-3">
      <header className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">{title}</h2>
        {description && <p className="text-xs text-ink-dim">{description}</p>}
      </header>
      <div className="grid gap-4 md:grid-cols-2">
        {items.map((it) => (
          <MessageCard key={it.key} item={it} updateUrl={updateUrl} resetUrl={resetUrl} />
        ))}
      </div>
    </section>
  )
}

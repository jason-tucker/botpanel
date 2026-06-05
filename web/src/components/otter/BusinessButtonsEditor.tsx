'use client'

/**
 * `<BusinessButtonsEditor>` — manage a business's custom command buttons
 * (the `/oc`, `/caked`, `/info` Link + Info buttons). Mirrors the in-Discord
 * "Manage Buttons" panel: add link/info buttons, edit, reorder, enable/disable
 * and delete. All writes go through `/api/otter/businesses/[slug]/buttons*`
 * which forwards to the bot's `business_buttons.*` RPC verbs.
 *
 * Like the other Otter editors we don't optimistically reconcile — every
 * successful mutation calls `router.refresh()` so the server component re-reads
 * the canonical list over RPC. Non-managers never reach this component; the
 * `canEdit` prop is threaded defensively anyway.
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ExternalLink } from 'lucide-react'
import { ServerForm } from '@/lib/forms/ServerForm'
import type { ButtonItem, ButtonStyle, ButtonType } from '@/lib/otter/businessButtons'

const STYLE_OPTIONS: { value: ButtonStyle; label: string }[] = [
  { value: 'primary', label: 'Blurple' },
  { value: 'secondary', label: 'Grey' },
  { value: 'success', label: 'Green' },
  { value: 'danger', label: 'Red' },
]

const inputCls =
  'rounded-md border border-line bg-bg-card2 text-ink text-sm px-2 py-1.5 w-full'
const labelCls = 'text-[10px] uppercase tracking-wider text-ink-dim'
const btnCls =
  'rounded-md border border-line bg-bg-card2 text-ink text-xs px-2 py-1 hover:bg-bg-card disabled:opacity-40'

function AddButtonForm({ slug, onChanged }: { slug: string; onChanged: () => void }) {
  const [type, setType] = useState<ButtonType>('link')

  return (
    <section className="rounded-2xl border border-line bg-bg-card p-4 flex flex-col gap-3">
      <div className="text-xs uppercase tracking-wider text-ink-dim">Add a button</div>
      <ServerForm
        action={`/api/otter/businesses/${slug}/buttons`}
        method="POST"
        onSuccess={onChanged}
        resetOnSuccess
        className="flex flex-col gap-3"
      >
        <div className="flex flex-wrap gap-3">
          <label className="flex flex-col gap-1">
            <span className={labelCls}>Type</span>
            <select
              name="type"
              value={type}
              onChange={(e) => setType(e.target.value as ButtonType)}
              className="rounded-md border border-line bg-bg-card2 text-ink text-sm px-2 py-1.5"
            >
              <option value="link">Link (opens a URL)</option>
              <option value="info">Info (reveals a card)</option>
            </select>
          </label>
          <label className="flex-1 min-w-[12rem] flex flex-col gap-1">
            <span className={labelCls}>Label</span>
            <input name="label" required maxLength={80} placeholder="e.g. Order Form" className={inputCls} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelCls}>Emoji (optional)</span>
            <input name="emoji" maxLength={64} placeholder="🛒" className="rounded-md border border-line bg-bg-card2 text-ink text-sm px-2 py-1.5 w-28" />
          </label>
          {type === 'info' && (
            <label className="flex flex-col gap-1">
              <span className={labelCls}>Colour</span>
              <select name="style" defaultValue="primary" className="rounded-md border border-line bg-bg-card2 text-ink text-sm px-2 py-1.5">
                {STYLE_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        {type === 'link' ? (
          <label className="flex flex-col gap-1">
            <span className={labelCls}>Link URL</span>
            <input name="url" type="url" required placeholder="https://…" className={inputCls} />
          </label>
        ) : (
          <label className="flex flex-col gap-1">
            <span className={labelCls}>Card content (markdown)</span>
            <textarea name="body" required maxLength={4000} rows={4} placeholder="Shown when the button is clicked." className={`${inputCls} font-mono`} />
          </label>
        )}

        <button type="submit" className="self-start rounded-md border border-line bg-bg-card2 text-ink text-sm px-3 py-1.5 hover:bg-bg-card">
          Add button
        </button>
      </ServerForm>
    </section>
  )
}

function EditButtonForm({
  slug,
  item,
  onChanged,
}: {
  slug: string
  item: ButtonItem
  onChanged: () => void
}) {
  const [open, setOpen] = useState(false)
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={`self-start ${btnCls}`}>
        Edit
      </button>
    )
  }
  return (
    <ServerForm
      action={`/api/otter/businesses/${slug}/buttons/${item.id}`}
      method="PATCH"
      onSuccess={() => {
        setOpen(false)
        onChanged()
      }}
      className="flex flex-col gap-2 border-t border-line pt-2"
    >
      <label className="flex flex-col gap-1">
        <span className={labelCls}>Label</span>
        <input name="label" required maxLength={80} defaultValue={item.label} className={inputCls} />
      </label>
      <label className="flex flex-col gap-1">
        <span className={labelCls}>Emoji (optional)</span>
        <input name="emoji" maxLength={64} defaultValue={item.emoji ?? ''} className={inputCls} />
      </label>
      {item.type === 'link' ? (
        <label className="flex flex-col gap-1">
          <span className={labelCls}>Link URL</span>
          <input name="url" type="url" required defaultValue={item.url ?? ''} className={inputCls} />
        </label>
      ) : (
        <>
          <label className="flex flex-col gap-1">
            <span className={labelCls}>Colour</span>
            <select name="style" defaultValue={item.style} className="rounded-md border border-line bg-bg-card2 text-ink text-sm px-2 py-1.5 self-start">
              {STYLE_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelCls}>Card content (markdown)</span>
            <textarea name="body" required maxLength={4000} rows={4} defaultValue={item.body ?? ''} className={`${inputCls} font-mono`} />
          </label>
        </>
      )}
      <div className="flex items-center gap-2">
        <button type="submit" className={btnCls}>
          Save
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-md border border-line text-ink-dim text-xs px-2 py-1 hover:text-ink">
          Cancel
        </button>
      </div>
    </ServerForm>
  )
}

function ButtonCard({
  slug,
  item,
  index,
  total,
  orderedIds,
  canEdit,
  onChanged,
}: {
  slug: string
  item: ButtonItem
  index: number
  total: number
  orderedIds: string[]
  canEdit: boolean
  onChanged: () => void
}) {
  const reorderTo = (dir: 'up' | 'down'): string => {
    const ids = [...orderedIds]
    const swap = dir === 'up' ? index - 1 : index + 1
    ;[ids[index], ids[swap]] = [ids[swap], ids[index]]
    return JSON.stringify(ids)
  }

  return (
    <div className={`rounded-2xl bg-bg-card p-4 flex flex-col gap-3 ring-1 ring-line ${item.enabled ? '' : 'opacity-60'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <span className="font-semibold text-ink break-words">
            {item.emoji ? `${item.emoji} ` : ''}
            {item.label}
          </span>
          <span className="text-[10px] uppercase tracking-wider text-ink-dim">
            {item.type === 'link' ? 'Link button' : `Info button · ${item.style}`}
            {item.enabled ? '' : ' · disabled'}
          </span>
        </div>
        {item.type === 'link' && item.url && (
          <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-ink-dim hover:text-ink" title={item.url}>
            <ExternalLink className="w-4 h-4" aria-hidden />
          </a>
        )}
      </div>

      {item.type === 'info' && item.body && (
        <p className="text-xs text-ink-dim whitespace-pre-wrap line-clamp-4">{item.body}</p>
      )}

      {canEdit && (
        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-2">
          <ServerForm action={`/api/otter/businesses/${slug}/buttons`} method="PUT" onSuccess={onChanged}>
            <input type="hidden" name="orderedIds" value={reorderTo('up')} />
            <button type="submit" className={btnCls} disabled={index === 0} title="Move up">
              ↑
            </button>
          </ServerForm>
          <ServerForm action={`/api/otter/businesses/${slug}/buttons`} method="PUT" onSuccess={onChanged}>
            <input type="hidden" name="orderedIds" value={reorderTo('down')} />
            <button type="submit" className={btnCls} disabled={index === total - 1} title="Move down">
              ↓
            </button>
          </ServerForm>
          <ServerForm action={`/api/otter/businesses/${slug}/buttons/${item.id}`} method="PATCH" onSuccess={onChanged}>
            <input type="hidden" name="enabled" value={(!item.enabled).toString()} />
            <button type="submit" className={btnCls}>
              {item.enabled ? 'Disable' : 'Enable'}
            </button>
          </ServerForm>
          <ServerForm
            action={`/api/otter/businesses/${slug}/buttons/${item.id}`}
            method="DELETE"
            confirm="Delete this button?"
            onSuccess={onChanged}
          >
            <button type="submit" className="rounded-md border border-red-500/40 bg-bg-card2 text-red-300 text-xs px-2 py-1 hover:bg-red-500/10">
              Delete
            </button>
          </ServerForm>
        </div>
      )}

      {canEdit && <EditButtonForm slug={slug} item={item} onChanged={onChanged} />}
    </div>
  )
}

export function BusinessButtonsEditor({
  slug,
  items,
  canEdit,
}: {
  slug: string
  items: ButtonItem[]
  canEdit: boolean
}) {
  const router = useRouter()
  const onChanged = () => router.refresh()
  const orderedIds = items.map((b) => b.id)

  return (
    <section className="rounded-2xl border border-line bg-bg-card p-5 flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-xs uppercase tracking-wider text-ink-dim">Custom command buttons</h2>
        <p className="text-sm text-ink-dim">
          Buttons added here appear on this business&apos;s command for everyone. Changes apply within ~30s.
        </p>
      </div>

      {canEdit && <AddButtonForm slug={slug} onChanged={onChanged} />}

      {items.length === 0 ? (
        <p className="text-sm text-ink-dim">No custom buttons yet.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {items.map((item, i) => (
            <ButtonCard
              key={item.id}
              slug={slug}
              item={item}
              index={i}
              total={items.length}
              orderedIds={orderedIds}
              canEdit={canEdit}
              onChanged={onChanged}
            />
          ))}
        </div>
      )}
    </section>
  )
}

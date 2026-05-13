'use client'

/**
 * Client-island form for /otter/move-channel.
 *
 * Two ChannelPickers (any-type and category-only) + position radio.
 * Submits JSON to `/api/otter/move-channel`.
 */
import { useState, type ReactNode } from 'react'
import { ServerForm } from '@/lib/forms/ServerForm'
import { ChannelPicker } from '@/components/pickers/ChannelPicker'

type Reply =
  | { ok: true; data: { channelName: string; fromCategoryName: string | null; toCategoryName: string; position: 'top' | 'bottom' } }
  | { ok: false; error: string; details?: unknown }

function OkStrip({ children }: { children: ReactNode }) {
  return (
    <div className="rounded border border-ok/30 bg-ok/10 px-3 py-2 text-sm text-ok">
      {children}
    </div>
  )
}

function ErrStrip({ error }: { error: string }) {
  return (
    <div className="rounded border border-err/30 bg-err/10 px-3 py-2 text-sm text-err">
      Failed: <code className="font-mono">{error}</code>
    </div>
  )
}

export function MoveChannelForm() {
  const [reply, setReply] = useState<Reply | null>(null)

  return (
    <section className="rounded-2xl border border-line bg-bg-card p-6 flex flex-col gap-4">
      <ServerForm
        action="/api/otter/move-channel"
        method="POST"
        onSuccess={(d) => {
          const r = d as Reply | null
          if (r) setReply(r)
        }}
        className="flex flex-col gap-4"
      >
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wider text-ink-dim">Channel to move</span>
          <ChannelPicker
            name="channelId"
            bot="otter"
            types={['text', 'voice', 'forum', 'announcement']}
            required
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wider text-ink-dim">Target category</span>
          <ChannelPicker
            name="categoryId"
            bot="otter"
            types={['category']}
            required
          />
        </label>

        <fieldset className="flex items-center gap-4">
          <legend className="text-xs uppercase tracking-wider text-ink-dim">Position</legend>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="position" value="top" defaultChecked />
            <span>Top</span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="position" value="bottom" />
            <span>Bottom</span>
          </label>
        </fieldset>

        <div className="flex items-center justify-end">
          <button
            type="submit"
            className="rounded-md border border-accent/40 bg-accent/15 px-4 py-2 text-sm text-accent hover:bg-accent/25"
          >
            Move channel
          </button>
        </div>
      </ServerForm>

      {reply !== null &&
        (reply.ok ? (
          <OkStrip>
            Moved <strong>#{reply.data.channelName}</strong> from{' '}
            <strong>{reply.data.fromCategoryName ?? '(no category)'}</strong> →{' '}
            <strong>{reply.data.toCategoryName}</strong> ({reply.data.position}).
          </OkStrip>
        ) : (
          <ErrStrip error={reply.error} />
        ))}
    </section>
  )
}

'use client'

/**
 * `<CakedPoster>` — four side-by-side post forms, one per card kind.
 *
 * Each form is a thin `<ServerForm>` wrapper posting `{channelId, kind, body?}`
 * to `/api/otter/caked/post`. The route discriminates by `kind` and routes
 * to the bot's `caked.message_post` verb. We keep four distinct forms (vs.
 * a single dropdown) for two reasons:
 *
 *   1. Discoverability — a manager scanning the page sees every card kind
 *      they can post, without having to discover them via a hidden select.
 *   2. Per-form isolation — a fat-fingered announcement body doesn't
 *      survive a failed contact-card submit. Each form's state is its own.
 *
 * The announcement form uses a textarea (max 2000 chars, enforced both
 * client-side via `maxLength` and server-side in the route's zod schema).
 * Channel ID is a raw text input for MVP — Wave 7d will swap it for a
 * `<ChannelPicker>` once the bot exposes `channels.list`.
 *
 * On success we show a short status banner with the `messageId` returned
 * by the bot. Errors surface via `<ServerForm>`'s built-in error banner;
 * RPC-level failures (timeout, channel-not-found, etc.) come back inside a
 * 200 response under `reply`, so we also peek at `reply.ok === false` and
 * surface that as a non-fatal status.
 */
import { useState, type ReactNode } from 'react'
import { ServerForm } from '@/lib/forms/ServerForm'

type Kind = 'contact' | 'event' | 'pricing' | 'announcement'

type Reply =
  | { ok: true; data: { messageId: string; channelId: string; kind: Kind } }
  | { ok: false; error: string; details?: unknown }

interface ApiResponse {
  reply?: Reply
}

interface PostStatus {
  ok: boolean
  text: string
}

const KIND_META: Record<Kind, { title: string; blurb: string; tone: string }> = {
  contact: {
    title: 'Contact Info Card',
    blurb:
      'Posts the standalone "have these ready" contact-info card (name, phone, bank).',
    tone: 'text-accent',
  },
  event: {
    title: 'Event Info Card',
    blurb:
      'Posts the standalone event-info card (date, headcount, dietary, items).',
    tone: 'text-accent',
  },
  pricing: {
    title: 'Pricing Card',
    blurb:
      'Posts the canned pricing card with cake / catering / add-on rates and the pricing image.',
    tone: 'text-accent',
  },
  announcement: {
    title: 'Announcement',
    blurb:
      'Free-form text wrapped in the Caked brand container. ≤2000 chars. Markdown is allowed.',
    tone: 'text-warn',
  },
}

function StatusBanner({ status }: { status: PostStatus | null }): ReactNode {
  if (!status) return null
  const cls = status.ok
    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
    : 'border-amber-500/40 bg-amber-500/10 text-amber-200'
  return (
    <div
      role="status"
      className={`rounded-md border px-3 py-2 text-xs ${cls}`}
    >
      {status.text}
    </div>
  )
}

function CardForm({
  kind,
  title,
  blurb,
  tone,
}: {
  kind: Kind
  title: string
  blurb: string
  tone: string
}): React.JSX.Element {
  const [status, setStatus] = useState<PostStatus | null>(null)

  const handleSuccess = (data: unknown): void => {
    const reply = (data as ApiResponse | null)?.reply
    if (!reply) {
      setStatus({ ok: false, text: 'No reply from bot.' })
      return
    }
    if (reply.ok) {
      setStatus({
        ok: true,
        text: `Posted! messageId=${reply.data.messageId}`,
      })
    } else {
      const detail =
        typeof reply.details === 'string' ? `: ${reply.details}` : ''
      setStatus({ ok: false, text: `Bot returned ${reply.error}${detail}` })
    }
  }

  return (
    <section className="rounded-2xl border border-line bg-bg-card p-4 flex flex-col gap-3">
      <header className="flex flex-col gap-0.5">
        <h2 className={`text-base font-semibold ${tone}`}>{title}</h2>
        <p className="text-xs text-ink-dim">{blurb}</p>
      </header>

      <ServerForm
        action="/api/otter/caked/post"
        method="POST"
        onSuccess={handleSuccess}
        className="flex flex-col gap-3"
      >
        <input type="hidden" name="kind" value={kind} />

        <label className="flex flex-col gap-1 text-xs">
          <span className="text-ink-dim">Channel ID</span>
          <input
            name="channelId"
            type="text"
            inputMode="numeric"
            pattern="\d{17,20}"
            required
            placeholder="123456789012345678"
            className="rounded-md border border-line bg-bg-card2/40 px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent/50"
          />
        </label>

        {kind === 'announcement' && (
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-ink-dim">Announcement body</span>
            <textarea
              name="body"
              required
              maxLength={2000}
              rows={5}
              placeholder="Write your announcement here..."
              className="rounded-md border border-line bg-bg-card2/40 px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent/50 resize-y"
            />
            <span className="text-[10px] text-ink-dim self-end">
              Max 2000 chars
            </span>
          </label>
        )}

        <div className="flex items-center justify-between gap-2">
          <button
            type="submit"
            className="rounded-md border border-line bg-bg-card2/80 hover:bg-bg-card2 text-ink text-sm font-medium px-3 py-1.5"
          >
            Post to channel
          </button>
        </div>

        <StatusBanner status={status} />
      </ServerForm>
    </section>
  )
}

export function CakedPoster(): React.JSX.Element {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {(Object.keys(KIND_META) as Kind[]).map((k) => {
        const meta = KIND_META[k]
        return (
          <CardForm
            key={k}
            kind={k}
            title={meta.title}
            blurb={meta.blurb}
            tone={meta.tone}
          />
        )
      })}
    </div>
  )
}

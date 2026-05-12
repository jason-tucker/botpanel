'use client'

/**
 * Per-bot card for `/sudo/rpc-test`. Wraps `<ServerForm>` so we get the
 * CSRF header injection + 4xx error banner for free, and keeps the most
 * recent reply in local state to render below the form.
 *
 * The reply is rendered verbatim — JSON-pretty-printed in a `<pre>`. We
 * don't try to interpret it because the bot side returns arbitrary
 * `data` payloads and we want the operator to see exactly what came back.
 */
import { useState } from 'react'
import { ServerForm } from '@/lib/forms/ServerForm'

type Reply =
  | { ok: true; data: unknown }
  | { ok: false; error: string; details?: unknown }

interface ApiResponse {
  reply?: Reply
}

export function RpcTestCard({ bot }: { bot: 'squishy' | 'otter' }) {
  const [reply, setReply] = useState<Reply | null>(null)
  const [sentAt, setSentAt] = useState<string | null>(null)

  const onSuccess = (data: unknown): void => {
    const r = (data as ApiResponse | null)?.reply
    if (r && typeof r === 'object' && 'ok' in r) {
      setReply(r as Reply)
    } else {
      setReply({ ok: false, error: 'bad-reply', details: data })
    }
    setSentAt(new Date().toISOString())
  }

  const label = bot === 'squishy' ? 'SquishyBot' : 'OtterBot'

  return (
    <div className="rounded-xl border border-line bg-bg-card overflow-hidden flex flex-col">
      <header className="px-4 py-3 border-b border-line">
        <h2 className="text-lg font-semibold capitalize">{label}</h2>
        <p className="text-xs text-ink-dim">
          Verb: <code className="font-mono">echo</code>
        </p>
      </header>

      <ServerForm
        action="/api/admin/rpc-test"
        method="POST"
        onSuccess={onSuccess}
        className="flex flex-col gap-2 p-4 border-b border-line bg-bg-card2/40"
      >
        {/* Hidden bot field — the API route reads this off the JSON body
            (ServerForm defaults to JSON, including hidden inputs). */}
        <input type="hidden" name="bot" value={bot} />
        <label className="text-xs uppercase tracking-wider text-ink-dim">
          Message
        </label>
        <input
          type="text"
          name="message"
          placeholder={`ping ${label.toLowerCase()}`}
          required
          maxLength={500}
          defaultValue="hello from the panel"
          className="rounded border border-line bg-bg-card px-2 py-1 font-mono text-xs text-ink focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <button
          type="submit"
          className="self-start rounded border border-line bg-bg-card px-3 py-1 text-xs text-ink hover:bg-bg-card2"
        >
          Send echo
        </button>
      </ServerForm>

      <div className="p-4 flex-1">
        <h3 className="text-xs uppercase tracking-wider text-ink-dim mb-2">
          Last reply
        </h3>
        {reply === null ? (
          <p className="text-sm text-ink-dim italic">
            No call sent yet.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 text-xs">
              {reply.ok ? (
                <span className="inline-flex items-center rounded-full border border-ok/30 bg-ok/15 px-2 py-0.5 font-medium uppercase tracking-wider text-ok">
                  ok
                </span>
              ) : (
                <span className="inline-flex items-center rounded-full border border-err/30 bg-err/15 px-2 py-0.5 font-medium uppercase tracking-wider text-err">
                  {reply.error}
                </span>
              )}
              {sentAt && (
                <span className="text-ink-dim" title={sentAt}>
                  {new Date(sentAt).toLocaleTimeString()}
                </span>
              )}
            </div>
            <pre className="rounded border border-line bg-bg-card2/60 p-2 text-[11px] font-mono text-ink-dim overflow-x-auto whitespace-pre-wrap break-all">
{JSON.stringify(reply, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  )
}

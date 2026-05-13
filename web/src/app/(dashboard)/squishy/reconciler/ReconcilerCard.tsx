'use client'

/**
 * Standalone Reconciler card — same wiring as `<AdminOpsCard>`'s third
 * button but laid out as a full panel section. Confirms before submit
 * because the reconciler is the heaviest of the admin ops.
 */
import { useState, type ReactNode } from 'react'
import { ServerForm } from '@/lib/forms/ServerForm'

type RpcReply<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; details?: unknown }

type ReconcilerResult = {
  recovered: number
  cleaned: number
  hubs: number
  panels: number
  adopted: number
}

function readReply<T>(data: unknown): RpcReply<T> {
  const r = (data as { reply?: unknown } | null)?.reply
  if (r && typeof r === 'object' && 'ok' in r) return r as RpcReply<T>
  return { ok: false, error: 'bad-reply', details: data }
}

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

export function ReconcilerCard() {
  const [reply, setReply] = useState<RpcReply<ReconcilerResult> | null>(null)
  return (
    <section className="rounded-2xl border border-line bg-bg-card p-6 flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h2 className="text-lg font-semibold">Run reconciler now</h2>
        <p className="text-xs text-ink-dim font-mono">
          cmd.squishy.admin.reconciler_run
        </p>
      </div>
      <ServerForm
        action="/api/sudo/admin/reconciler"
        method="POST"
        confirm="Re-run the voice reconciler? This walks every auto_channels row and syncs Discord state — heavy."
        onSuccess={(d) => setReply(readReply<ReconcilerResult>(d))}
      >
        <button
          type="submit"
          className="rounded-md border border-warn/40 bg-warn/15 px-4 py-2 text-sm text-warn hover:bg-warn/25"
        >
          Run reconciler
        </button>
      </ServerForm>
      {reply !== null &&
        (reply.ok ? (
          <OkStrip>
            Recovered <strong>{reply.data.recovered}</strong> · Cleaned{' '}
            <strong>{reply.data.cleaned}</strong> · Hubs{' '}
            <strong>{reply.data.hubs}</strong> · Panels{' '}
            <strong>{reply.data.panels}</strong> · Adopted{' '}
            <strong>{reply.data.adopted}</strong>
          </OkStrip>
        ) : (
          <ErrStrip error={reply.error} />
        ))}
    </section>
  )
}

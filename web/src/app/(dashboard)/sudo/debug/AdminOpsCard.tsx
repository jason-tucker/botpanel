'use client'

/**
 * Admin write-ops card for `/sudo/debug` — the Wave 7b surface.
 *
 * Three buttons, each a `<ServerForm>` so they share the CSRF + 4xx-error
 * machinery used everywhere else:
 *
 *  1. **Reload caches** → `/api/sudo/admin/reload-caches`. On success, the
 *     bot returns `{reloaded: [...]}`; we render a green inline strip with
 *     the comma-separated cache names. No confirm — reloading is cheap.
 *
 *  2. **Orphan scan** → `/api/sudo/admin/orphan-scan`. On success, the bot
 *     returns `{orphans: [{table, id, reason}]}`; we render the list as a
 *     table below the button row. Empty → "No orphans found ✓".
 *
 *  3. **Run reconciler** → `/api/sudo/admin/reconciler`. Wrapped in a
 *     `confirm:` because the reconciler is the heaviest of the three ops
 *     (touches every auto_channels row, syncs perms, rebuilds panels).
 *     On success, render the stats `{recovered, cleaned, hubs, panels,
 *     adopted}` inline.
 *
 * The three results don't share state — each op has its own inline result
 * region directly below its button, so a successful orphan scan doesn't
 * blow away the previous "reload caches" success strip and vice versa.
 * Each region is exclusively owned by its op.
 *
 * Failure rendering: any non-`ok:true` reply (timeout / rpc-not-configured
 * / bot threw / etc.) surfaces in a red strip carrying `reply.error`. We
 * never silently succeed — the operator needs to know the call didn't go
 * through.
 */
import { useState, type ReactNode } from 'react'
import { ServerForm } from '@/lib/forms/ServerForm'

type RpcReply<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; details?: unknown }

type Orphan = { table: string; id: string; reason: string }
type ReconcilerResult = {
  recovered: number
  cleaned: number
  hubs: number
  panels: number
  adopted: number
}

// Generic helper so each op only has to map its parsed body into the
// `{ok, ...}` shape — keeps each card's onSuccess one-liner.
function readReply<T>(data: unknown): RpcReply<T> {
  const r = (data as { reply?: unknown } | null)?.reply
  if (r && typeof r === 'object' && 'ok' in r) {
    return r as RpcReply<T>
  }
  return { ok: false, error: 'bad-reply', details: data }
}

function OkStrip({ children }: { children: ReactNode }) {
  return (
    <div className="rounded border border-ok/30 bg-ok/10 px-3 py-2 text-xs text-ok">
      {children}
    </div>
  )
}

function ErrStrip({ error }: { error: string }) {
  return (
    <div className="rounded border border-err/30 bg-err/10 px-3 py-2 text-xs text-err">
      Failed: <code className="font-mono">{error}</code>
    </div>
  )
}

function ReloadCachesButton() {
  const [reply, setReply] = useState<RpcReply<{ reloaded: string[] }> | null>(null)
  return (
    <div className="flex flex-col gap-2">
      <ServerForm
        action="/api/sudo/admin/reload-caches"
        method="POST"
        onSuccess={(d) => setReply(readReply<{ reloaded: string[] }>(d))}
        className="inline"
      >
        <button
          type="submit"
          className="rounded border border-line bg-bg-card px-3 py-1 text-xs text-ink hover:bg-bg-card2"
        >
          Reload caches
        </button>
      </ServerForm>
      {reply !== null && (
        reply.ok ? (
          <OkStrip>
            Reloaded: {reply.data.reloaded.join(', ')}
          </OkStrip>
        ) : (
          <ErrStrip error={reply.error} />
        )
      )}
    </div>
  )
}

function OrphanScanButton() {
  const [reply, setReply] = useState<RpcReply<{ orphans: Orphan[] }> | null>(null)
  return (
    <div className="flex flex-col gap-2">
      <ServerForm
        action="/api/sudo/admin/orphan-scan"
        method="POST"
        onSuccess={(d) => setReply(readReply<{ orphans: Orphan[] }>(d))}
        className="inline"
      >
        <button
          type="submit"
          className="rounded border border-line bg-bg-card px-3 py-1 text-xs text-ink hover:bg-bg-card2"
        >
          Orphan scan
        </button>
      </ServerForm>
      {reply !== null && (
        !reply.ok ? (
          <ErrStrip error={reply.error} />
        ) : reply.data.orphans.length === 0 ? (
          <OkStrip>No orphans found ✓</OkStrip>
        ) : (
          <div className="overflow-x-auto rounded border border-warn/30 bg-warn/5">
            <table className="w-full text-left text-xs">
              <thead className="bg-bg-card2 text-[10px] uppercase tracking-wider text-ink-dim">
                <tr>
                  <th className="px-3 py-2 font-medium">Table</th>
                  <th className="px-3 py-2 font-medium">Row id</th>
                  <th className="px-3 py-2 font-medium">Reason</th>
                </tr>
              </thead>
              <tbody>
                {reply.data.orphans.map((o, i) => (
                  <tr
                    key={`${o.table}:${o.id}:${i}`}
                    className="border-b border-line/60 last:border-b-0"
                  >
                    <td className="px-3 py-1.5 font-mono">{o.table}</td>
                    <td className="px-3 py-1.5 font-mono text-ink-dim">{o.id}</td>
                    <td className="px-3 py-1.5 text-ink-dim">{o.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  )
}

function ReconcilerButton() {
  const [reply, setReply] = useState<RpcReply<ReconcilerResult> | null>(null)
  return (
    <div className="flex flex-col gap-2">
      <ServerForm
        action="/api/sudo/admin/reconciler"
        method="POST"
        confirm="Re-run the voice reconciler? This walks every auto_channels row and syncs perms — heavy op."
        onSuccess={(d) => setReply(readReply<ReconcilerResult>(d))}
        className="inline"
      >
        <button
          type="submit"
          className="rounded border border-warn/30 bg-warn/10 px-3 py-1 text-xs text-warn hover:bg-warn/20"
        >
          Run reconciler
        </button>
      </ServerForm>
      {reply !== null && (
        reply.ok ? (
          <OkStrip>
            Recovered <strong>{reply.data.recovered}</strong> ·
            Cleaned <strong>{reply.data.cleaned}</strong> ·
            Hubs <strong>{reply.data.hubs}</strong> ·
            Panels <strong>{reply.data.panels}</strong> ·
            Adopted <strong>{reply.data.adopted}</strong>
          </OkStrip>
        ) : (
          <ErrStrip error={reply.error} />
        )
      )}
    </div>
  )
}

export function AdminOpsCard() {
  return (
    <section className="rounded-xl border border-line bg-bg-card overflow-hidden">
      <header className="flex items-baseline justify-between gap-3 px-4 py-3 border-b border-line">
        <h2 className="text-lg font-semibold">Admin ops</h2>
        <p className="text-xs text-ink-dim">
          Live writes via the Redis command bus —{' '}
          <code className="font-mono">cmd.squishy.admin.*</code>.
        </p>
      </header>
      <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-4">
        <ReloadCachesButton />
        <OrphanScanButton />
        <ReconcilerButton />
      </div>
    </section>
  )
}

'use client'

/**
 * Cleanup card — two buttons (Scan, Clean up) with their own result strips.
 *
 * Scan calls `/api/sudo/admin/orphan-scan` (existing route, read-only walk).
 * Clean up calls `/api/sudo/admin/orphan-cleanup` (new route, deletes
 * entirely-orphan rows). The cleanup button is disabled until a scan has
 * been run and shown orphans — clicking "Clean up" with no scan is a
 * useless action.
 */
import { useState, type ReactNode } from 'react'
import { ServerForm } from '@/lib/forms/ServerForm'

type RpcReply<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; details?: unknown }

type Orphan = { table: string; id: string; reason: string }
type CleanupResult = { deleted: number; byTable: Record<string, number> }

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

export function CleanupCard() {
  const [scan, setScan] = useState<RpcReply<{ orphans: Orphan[] }> | null>(null)
  const [cleanup, setCleanup] = useState<RpcReply<CleanupResult> | null>(null)

  const orphanCount =
    scan && scan.ok ? scan.data.orphans.length : null
  const canCleanup = orphanCount !== null && orphanCount > 0

  return (
    <section className="rounded-2xl border border-line bg-bg-card p-6 flex flex-col gap-5">
      {/* Scan */}
      <div className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <h2 className="text-lg font-semibold">1 · Scan for orphans</h2>
          <p className="text-xs text-ink-dim font-mono">cmd.squishy.admin.orphan_scan</p>
        </div>
        <ServerForm
          action="/api/sudo/admin/orphan-scan"
          method="POST"
          onSuccess={(d) => {
            setScan(readReply<{ orphans: Orphan[] }>(d))
            // Reset cleanup result whenever a new scan is run.
            setCleanup(null)
          }}
        >
          <button
            type="submit"
            className="rounded-md border border-line bg-bg-card2 px-4 py-2 text-sm text-ink hover:bg-bg-card2/70"
          >
            Scan for orphans
          </button>
        </ServerForm>
        {scan !== null &&
          (!scan.ok ? (
            <ErrStrip error={scan.error} />
          ) : scan.data.orphans.length === 0 ? (
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
                  {scan.data.orphans.map((o, i) => (
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
          ))}
      </div>

      {/* Cleanup */}
      <div className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <h2 className="text-lg font-semibold">2 · Clean up orphan rows</h2>
          <p className="text-xs text-ink-dim font-mono">cmd.squishy.admin.orphan_cleanup</p>
        </div>
        <p className="text-xs text-ink-dim">
          Deletes rows where <strong>every</strong> Discord reference is gone.
          Rows with partial orphans are left for manual repair via the Games
          panel. {orphanCount === null
            ? 'Run a scan above first.'
            : orphanCount === 0
              ? 'Nothing to clean.'
              : `Will delete up to ${orphanCount} row${orphanCount === 1 ? '' : 's'}.`}
        </p>
        <ServerForm
          action="/api/sudo/admin/orphan-cleanup"
          method="POST"
          confirm="Delete all entirely-orphan rows from auto_channels, hub_channels, auto_thread_channels, and archived_channels?"
          onSuccess={(d) => setCleanup(readReply<CleanupResult>(d))}
        >
          <button
            type="submit"
            disabled={!canCleanup}
            className="rounded-md border border-err/40 bg-err/15 px-4 py-2 text-sm text-err hover:bg-err/25 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Clean up orphan rows
          </button>
        </ServerForm>
        {cleanup !== null &&
          (cleanup.ok ? (
            <OkStrip>
              Deleted <strong>{cleanup.data.deleted}</strong> row
              {cleanup.data.deleted === 1 ? '' : 's'} —{' '}
              {Object.entries(cleanup.data.byTable)
                .filter(([, n]) => n > 0)
                .map(([t, n]) => `${t}: ${n}`)
                .join(', ') || 'no rows met the entirely-orphan threshold'}
            </OkStrip>
          ) : (
            <ErrStrip error={cleanup.error} />
          ))}
      </div>
    </section>
  )
}

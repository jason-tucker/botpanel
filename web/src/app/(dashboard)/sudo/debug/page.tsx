/**
 * /sudo/debug — Debug Snapshot (bot-owner-only).
 *
 * Mirrors what Squishy's `/sudo → Settings → Debug` panel shows in Discord:
 * a live look at the bot's runtime introspection surface so the operator can
 * triage from the web without dropping into the Discord client.
 *
 * Three cards, fetched in parallel via `Promise.allSettled` so one downed
 * source doesn't take the page out:
 *   1. Feature flags  — `bot_settings` rows where `key LIKE 'feature.%'`.
 *                       Values are `'true'`/`'false'` strings; we render
 *                       enabled/disabled pills off that.
 *   2. Heartbeats     — `getHeartbeats()` from `lib/heartbeats.ts` (already
 *                       wired into Redis pub/sub). Per-bot card with
 *                       lastSeen, uptime, version, guildCount.
 *   3. Setting changes — last 20 `setting_changes` rows, desc by changedAt,
 *                        showing key, old → new (truncated), actor, when.
 *
 * Gating: bot-owner only. Squishy sudo (without owner) sees the same 403
 * card pattern the Admin Home uses — Debug is owner-only because write
 * actions land here too (Wave 7b: reload caches, orphan scan, reconciler
 * run) and we want the read path to share the same gate as the write path
 * so a sudo grant can't accidentally widen access on a later cutover.
 *
 * Write surface (Wave 7b): `<AdminOpsCard>` renders three buttons that
 * POST to `/api/sudo/admin/{reload-caches, orphan-scan, reconciler}`
 * which forward to the bot via `callBot('squishy', 'admin.*', {})`. Each
 * route is bot-owner gated + CSRF + rate-limited 5/min/actor, and audits
 * to `admin.caches_reloaded` / `admin.orphan_scan_run` / `admin.reconciler_run`.
 */
import { redirect } from 'next/navigation'
import { desc, like } from 'drizzle-orm'
import { getSession } from '@/lib/auth/session'
import { resolveAccess } from '@/lib/auth/perms'
import { squishyDb } from '@/lib/db/squishy'
import { botSettings, settingChanges } from '@/lib/db/schema/squishy'
import { getHeartbeats } from '@/lib/heartbeats'
import { relTime } from '@/lib/util/format'
import { AdminOpsCard } from './AdminOpsCard'

export const dynamic = 'force-dynamic'

type FeatureFlagRow = {
  key: string
  value: string
  updatedAt: Date | null
  updatedByDiscordId: string | null
}

type SettingChangeRow = {
  id: string
  key: string
  oldValue: string | null
  newValue: string | null
  changedByUserId: string | null
  changedAt: Date
}

type HeartbeatSnapshot = Record<string, Record<string, unknown>>

async function loadFeatureFlags(): Promise<FeatureFlagRow[]> {
  const rows = await squishyDb
    .select({
      key: botSettings.key,
      value: botSettings.value,
      updatedAt: botSettings.updatedAt,
      updatedByDiscordId: botSettings.updatedByDiscordId,
    })
    .from(botSettings)
    .where(like(botSettings.key, 'feature.%'))
  // Sort client-side (alpha asc on key) so a missing index doesn't surprise
  // us — the table's small (a handful of feature.* rows) so this is cheap.
  return rows.sort((a, b) => a.key.localeCompare(b.key))
}

async function loadRecentSettingChanges(): Promise<SettingChangeRow[]> {
  return await squishyDb
    .select({
      id: settingChanges.id,
      key: settingChanges.key,
      oldValue: settingChanges.oldValue,
      newValue: settingChanges.newValue,
      changedByUserId: settingChanges.changedByUserId,
      changedAt: settingChanges.changedAt,
    })
    .from(settingChanges)
    .orderBy(desc(settingChanges.changedAt))
    .limit(20)
}

// `getHeartbeats()` is synchronous and ships its own Redis-down fallback
// (empty Map), but we still wrap it so a bug in the snapshot reader can't
// crash the whole page — the card just shows "no heartbeats" instead.
async function loadHeartbeats(): Promise<HeartbeatSnapshot> {
  return getHeartbeats()
}

function settled<T>(r: PromiseSettledResult<T>): T | null {
  return r.status === 'fulfilled' ? r.value : null
}

function truncate(value: string | null | undefined, max = 60): string {
  if (value === null || value === undefined) return '∅'
  if (value.length <= max) return value
  return `${value.slice(0, max - 1)}…`
}

function FeatureFlagPill({ value }: { value: string }) {
  // Squishy stores feature flags as text 'true'/'false'. Anything else is
  // treated as "other" so we don't lie about state on a row we don't grok.
  const v = value.trim().toLowerCase()
  if (v === 'true') {
    return (
      <span className="inline-flex items-center rounded-full border border-ok/30 bg-ok/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-ok">
        enabled
      </span>
    )
  }
  if (v === 'false') {
    return (
      <span className="inline-flex items-center rounded-full border border-line bg-bg-card2 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-ink-dim">
        disabled
      </span>
    )
  }
  return (
    <span className="inline-flex items-center rounded-full border border-warn/30 bg-warn/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-warn">
      {truncate(value, 12)}
    </span>
  )
}

function DataUnavailable({ what }: { what: string }) {
  return (
    <div className="rounded-lg border border-line bg-bg-card2/40 p-4 text-sm text-err">
      {what} data unavailable — the SquishyBot database isn&apos;t reachable
      right now. Other sections may still render.
    </div>
  )
}

function NotAuthorizedCard({ isSudo }: { isSudo: boolean }) {
  return (
    <div className="p-6 sm:p-10 pt-16 md:pt-10">
      <div className="max-w-md mx-auto rounded-2xl border border-line bg-bg-card p-6 flex flex-col gap-3">
        <h1 className="text-xl font-semibold">403 — Not allowed</h1>
        <p className="text-ink-dim text-sm">
          {isSudo ? (
            <>
              Debug Snapshot is bot-owner-only. The write actions (reload
              caches, orphan scan, run reconciler) hit the bot directly
              over the command bus, so we keep the read path gated to the
              same audience — sudo grants don&apos;t cover this view.
            </>
          ) : (
            <>
              Debug Snapshot is bot-owner-only. If you think you should
              have access, ask the bot owner — sudo grants don&apos;t
              cover this view.
            </>
          )}
        </p>
      </div>
    </div>
  )
}

function formatUptime(seconds: unknown): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return '—'
  if (seconds < 60) return `${Math.round(seconds)}s`
  const m = Math.floor(seconds / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  const rm = m % 60
  if (h < 24) return rm === 0 ? `${h}h` : `${h}h ${rm}m`
  const d = Math.floor(h / 24)
  const rh = h % 24
  return rh === 0 ? `${d}d` : `${d}d ${rh}h`
}

function HeartbeatCard({
  name,
  row,
}: {
  name: string
  row: Record<string, unknown>
}) {
  const lastSeen = typeof row.lastSeen === 'string' ? row.lastSeen : null
  const version = typeof row.version === 'string' ? row.version : null
  const guildCount =
    typeof row.guildCount === 'number' ? row.guildCount : null
  const uptime = formatUptime(row.uptime)

  return (
    <div className="rounded-lg border border-line bg-bg-card2/40 p-3 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="inline-block w-2 h-2 rounded-full bg-ok"
          />
          <span className="text-sm font-semibold capitalize">{name}</span>
        </div>
        <span className="inline-flex items-center rounded-full border border-ok/30 bg-ok/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-ok">
          live
        </span>
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <dt className="text-ink-dim">Last beat</dt>
        <dd
          className="text-ink-dim font-mono"
          title={lastSeen ?? ''}
        >
          {lastSeen ? relTime(lastSeen) : '—'}
        </dd>
        <dt className="text-ink-dim">Uptime</dt>
        <dd className="text-ink-dim font-mono">{uptime}</dd>
        <dt className="text-ink-dim">Version</dt>
        <dd className="text-ink-dim font-mono">{version ?? '—'}</dd>
        {guildCount !== null && (
          <>
            <dt className="text-ink-dim">Guilds</dt>
            <dd className="text-ink-dim font-mono">{guildCount}</dd>
          </>
        )}
      </dl>
    </div>
  )
}

export default async function DebugSnapshotPage() {
  const session = await getSession()
  if (!session) redirect('/api/auth/login')

  const access = await resolveAccess(session)
  if (!access.botOwner) {
    return <NotAuthorizedCard isSudo={access.squishy.sudo} />
  }

  // Per-section try/catch wrappers — even though `Promise.allSettled` would
  // catch a throw, wrapping the loaders directly keeps a console.warn on the
  // rejection so an operator pulling container logs sees the underlying
  // error (allSettled's `.reason` shape is awkward to log generically).
  const [flagsRes, heartbeatsRes, changesRes] = await Promise.allSettled([
    loadFeatureFlags(),
    loadHeartbeats(),
    loadRecentSettingChanges(),
  ])

  const flags = settled(flagsRes)
  const heartbeats = settled(heartbeatsRes)
  const changes = settled(changesRes)

  if (flagsRes.status === 'rejected') {
    console.warn('[sudo/debug] feature flags load failed', flagsRes.reason)
  }
  if (heartbeatsRes.status === 'rejected') {
    console.warn('[sudo/debug] heartbeats snapshot failed', heartbeatsRes.reason)
  }
  if (changesRes.status === 'rejected') {
    console.warn('[sudo/debug] setting_changes load failed', changesRes.reason)
  }

  const heartbeatEntries = heartbeats
    ? Object.entries(heartbeats).sort(([a], [b]) => a.localeCompare(b))
    : []

  return (
    <div className="p-6 sm:p-10 pt-16 md:pt-10">
      <div className="max-w-6xl mx-auto flex flex-col gap-6">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">Debug Snapshot</h1>
          <p className="text-sm text-ink-dim">
            Live runtime introspection — bot-owner only.
          </p>
        </header>

        {/* --- Admin ops (Wave 7b) ----------------------------------- */}
        <AdminOpsCard />

        {/* --- Feature flags ----------------------------------------- */}
        <section className="rounded-xl border border-line bg-bg-card overflow-hidden">
          <header className="flex items-baseline justify-between gap-3 px-4 py-3 border-b border-line">
            <h2 className="text-lg font-semibold">Feature flags</h2>
            <p className="text-xs text-ink-dim">
              <code className="font-mono">bot_settings</code> rows with{' '}
              <code className="font-mono">key LIKE &apos;feature.%&apos;</code>.
            </p>
          </header>
          {flags === null ? (
            <div className="p-4">
              <DataUnavailable what="Feature flags" />
            </div>
          ) : flags.length === 0 ? (
            <div className="p-4 text-sm text-ink-dim">
              No <code className="font-mono">feature.*</code> rows in{' '}
              <code className="font-mono">bot_settings</code>. Flags inherit
              their defaults from the bot&apos;s env until overridden.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-bg-card2 text-xs uppercase tracking-wider text-ink-dim">
                  <tr>
                    <th className="px-3 py-2 font-medium">Flag</th>
                    <th className="px-3 py-2 font-medium">State</th>
                    <th className="px-3 py-2 font-medium">Updated</th>
                    <th className="px-3 py-2 font-medium">By</th>
                  </tr>
                </thead>
                <tbody>
                  {flags.map((f) => (
                    <tr
                      key={f.key}
                      className="border-b border-line last:border-b-0"
                    >
                      <td className="px-3 py-2 font-mono text-xs">
                        {f.key}
                      </td>
                      <td className="px-3 py-2">
                        <FeatureFlagPill value={f.value} />
                      </td>
                      <td
                        className="px-3 py-2 text-xs text-ink-dim whitespace-nowrap"
                        title={f.updatedAt ? f.updatedAt.toISOString() : ''}
                      >
                        {f.updatedAt ? (
                          relTime(f.updatedAt)
                        ) : (
                          <span className="italic">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-ink-dim whitespace-nowrap">
                        {f.updatedByDiscordId ? (
                          <>&lt;@{f.updatedByDiscordId}&gt;</>
                        ) : (
                          <span className="italic">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* --- Heartbeats -------------------------------------------- */}
        <section className="rounded-xl border border-line bg-bg-card overflow-hidden">
          <header className="flex items-baseline justify-between gap-3 px-4 py-3 border-b border-line">
            <h2 className="text-lg font-semibold">Heartbeats</h2>
            <p className="text-xs text-ink-dim">
              Live snapshot from{' '}
              <code className="font-mono">bot.*.bot.heartbeat</code>. Stale
              entries (no beat in 180s) are omitted.
            </p>
          </header>
          {heartbeats === null ? (
            <div className="p-4">
              <DataUnavailable what="Heartbeats" />
            </div>
          ) : heartbeatEntries.length === 0 ? (
            <div className="p-4 text-sm text-ink-dim">
              No live heartbeats. Either Redis is unreachable or no bot has
              published a beat in the last 180s.
            </div>
          ) : (
            <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
              {heartbeatEntries.map(([name, row]) => (
                <HeartbeatCard key={name} name={name} row={row} />
              ))}
            </div>
          )}
        </section>

        {/* --- Recent setting changes -------------------------------- */}
        <section className="rounded-xl border border-line bg-bg-card overflow-hidden">
          <header className="flex items-baseline justify-between gap-3 px-4 py-3 border-b border-line">
            <h2 className="text-lg font-semibold">Recent setting changes</h2>
            <p className="text-xs text-ink-dim">
              Last 20 rows from{' '}
              <code className="font-mono">setting_changes</code>.
            </p>
          </header>
          {changes === null ? (
            <div className="p-4">
              <DataUnavailable what="Setting changes" />
            </div>
          ) : changes.length === 0 ? (
            <div className="p-4 text-sm text-ink-dim">
              No setting changes recorded yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-bg-card2 text-xs uppercase tracking-wider text-ink-dim">
                  <tr>
                    <th className="px-3 py-2 font-medium">Key</th>
                    <th className="px-3 py-2 font-medium">Old → New</th>
                    <th className="px-3 py-2 font-medium">Actor</th>
                    <th className="px-3 py-2 font-medium">When</th>
                  </tr>
                </thead>
                <tbody>
                  {changes.map((c) => (
                    <tr
                      key={c.id}
                      className="border-b border-line last:border-b-0"
                    >
                      <td className="px-3 py-2 font-mono text-xs">
                        {c.key}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        <span
                          className="font-mono text-ink-dim"
                          title={c.oldValue ?? ''}
                        >
                          {truncate(c.oldValue)}
                        </span>
                        <span className="px-1 text-ink-dim">→</span>
                        <span
                          className="font-mono text-ink"
                          title={c.newValue ?? ''}
                        >
                          {truncate(c.newValue)}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-ink-dim whitespace-nowrap">
                        {c.changedByUserId ? (
                          <>&lt;@{c.changedByUserId}&gt;</>
                        ) : (
                          <span className="italic">—</span>
                        )}
                      </td>
                      <td
                        className="px-3 py-2 text-xs text-ink-dim whitespace-nowrap"
                        title={c.changedAt.toISOString()}
                      >
                        {relTime(c.changedAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

      </div>
    </div>
  )
}

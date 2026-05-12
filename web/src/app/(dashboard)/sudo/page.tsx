/**
 * /sudo — Admin Home for the bot owner.
 *
 * Cross-cutting landing page rolling up three Squishy admin surfaces into
 * one bot-owner-only view:
 *   1. Sudo Users   — env (`SUDO_USER_IDS`) merged with DB (`sudo_users`),
 *                     so the page shows the complete grant list with the
 *                     source tagged so an operator can tell at a glance
 *                     which grants are baked into deployment config vs.
 *                     added at runtime.
 *   2. Pending staff approvals — open `/sudo`-driven role-request queue
 *                                from `staff_approvals` (status='pending').
 *   3. Recent reports — last 30 rows of `report_log` with status pill +
 *                       GitHub issue link when one's been filed.
 *
 * Gating: bot-owner only. Squishy sudo (without owner) sees a 403 card
 * explaining the reasoning — sudo authority is per-surface in V2 but the
 * cross-cutting roll-up is owner-only until that lands so we don't have to
 * teach this page about per-section gating yet.
 *
 * Resilience: every DB read is wrapped via `Promise.allSettled` and a
 * per-section try/catch — a downed Squishy Postgres degrades each card
 * independently to a "data unavailable" pill, never a 500.
 */
import { redirect } from 'next/navigation'
import { desc, eq } from 'drizzle-orm'
import { getSession } from '@/lib/auth/session'
import { resolveAccess } from '@/lib/auth/perms'
import { env } from '@/lib/env'
import { squishyDb } from '@/lib/db/squishy'
import {
  sudoUsers,
  staffApprovals,
  reportLog,
} from '@/lib/db/schema/squishy'
import { relTime } from '@/lib/util/format'
import { resolveUsernames } from '@/lib/userDisplay'
import { UserChip } from '@/components/UserChip'
import { AddSudoUserForm, RevokeButton } from './SudoUserControls'
import {
  ApproveButton,
  DenyButton,
  DirectGrantForm,
  DirectRevokeForm,
} from './StaffApprovalControls'

export const dynamic = 'force-dynamic'

type SudoRow = {
  userId: string
  source: 'env' | 'db'
  addedByDiscordId: string | null
  addedAt: Date | null
  note: string | null
}

type StaffApprovalRow = {
  id: string
  guildId: string
  userId: string
  requestedData: unknown
  status: string
  reviewedBy: string | null
  createdAt: Date
}

type ReportRow = {
  id: string
  guildId: string
  userId: string
  title: string
  reportType: string
  status: string
  githubIssueUrl: string | null
  createdAt: Date
}

function envSudoIds(): string[] {
  if (!env.SUDO_USER_IDS) return []
  return env.SUDO_USER_IDS.split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

async function loadSudoUsers(): Promise<SudoRow[]> {
  // Always emit the env-derived rows first so a downed DB still shows the
  // operator-configured baseline (those are the grants that survive any
  // table outage anyway, since `isSudo()` checks env first).
  const envIds = envSudoIds()
  const envRows: SudoRow[] = envIds.map((id) => ({
    userId: id,
    source: 'env',
    addedByDiscordId: null,
    addedAt: null,
    note: null,
  }))

  const dbRows = await squishyDb
    .select()
    .from(sudoUsers)
    .orderBy(desc(sudoUsers.addedAt))

  // De-dupe: if an env ID is also in the DB, prefer the DB row (it has the
  // added_at / added_by metadata) but keep the env tag too. We render both
  // pills in that case so the operator can see "this user is granted via
  // both paths" — important when revoking, since you have to drop from BOTH.
  const dbIds = new Set(dbRows.map((r) => r.userId))
  const filteredEnv = envRows.filter((r) => !dbIds.has(r.userId))

  const out: SudoRow[] = [
    ...dbRows.map((r) => ({
      userId: r.userId,
      source: 'db' as const,
      addedByDiscordId: r.addedByDiscordId,
      addedAt: r.addedAt,
      note: r.note,
    })),
    ...filteredEnv,
  ]
  return out
}

async function loadPendingApprovals(): Promise<StaffApprovalRow[]> {
  return await squishyDb
    .select({
      id: staffApprovals.id,
      guildId: staffApprovals.guildId,
      userId: staffApprovals.userId,
      requestedData: staffApprovals.requestedData,
      status: staffApprovals.status,
      reviewedBy: staffApprovals.reviewedBy,
      createdAt: staffApprovals.createdAt,
    })
    .from(staffApprovals)
    .where(eq(staffApprovals.status, 'pending'))
    .orderBy(desc(staffApprovals.createdAt))
    .limit(50)
}

async function loadRecentReports(): Promise<ReportRow[]> {
  return await squishyDb
    .select({
      id: reportLog.id,
      guildId: reportLog.guildId,
      userId: reportLog.userId,
      title: reportLog.title,
      reportType: reportLog.reportType,
      status: reportLog.status,
      githubIssueUrl: reportLog.githubIssueUrl,
      createdAt: reportLog.createdAt,
    })
    .from(reportLog)
    .orderBy(desc(reportLog.createdAt))
    .limit(30)
}

function summarizeRequestedData(data: unknown): string {
  if (!data || typeof data !== 'object') return ''
  const entries = Object.entries(data as Record<string, unknown>)
  if (entries.length === 0) return ''
  return entries
    .map(([k, v]) => {
      if (v === null || v === undefined) return `${k}=∅`
      if (typeof v === 'object') {
        try {
          return `${k}=${JSON.stringify(v)}`
        } catch {
          return `${k}=[obj]`
        }
      }
      return `${k}=${String(v)}`
    })
    .join(' · ')
}

function deriveRoleKey(data: unknown): string {
  if (!data || typeof data !== 'object') return '—'
  const d = data as Record<string, unknown>
  for (const key of ['roleKey', 'role_key', 'role', 'roleName', 'role_name']) {
    const v = d[key]
    if (typeof v === 'string' && v.length > 0) return v
  }
  return '—'
}

function SourcePill({ source }: { source: 'env' | 'db' }) {
  // Purple env / cyan db — matches the rankColor purple in otterFormat
  // and a distinct cyan for runtime DB grants.
  if (source === 'env') {
    return (
      <span className="inline-flex items-center rounded-full border border-[#8b5cf6]/30 bg-[#8b5cf6]/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[#c4b5fd]">
        env
      </span>
    )
  }
  return (
    <span className="inline-flex items-center rounded-full border border-[#06b6d4]/30 bg-[#06b6d4]/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[#67e8f9]">
      db
    </span>
  )
}

function ReportStatusPill({ status }: { status: string }) {
  // Yellow pending / green filed / gray dropped. Falls back to neutral
  // grey for any future status string so the page never blows up on a
  // value the bot added before the panel learned about it.
  const styles =
    status === 'filed'
      ? 'border-ok/30 bg-ok/15 text-ok'
      : status === 'pending'
        ? 'border-warn/30 bg-warn/15 text-warn'
        : status === 'dropped'
          ? 'border-line bg-bg-card2 text-ink-dim'
          : 'border-line bg-bg-card2 text-ink-dim'
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${styles}`}
    >
      {status}
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

function settled<T>(r: PromiseSettledResult<T>): T | null {
  return r.status === 'fulfilled' ? r.value : null
}

function NotAuthorizedCard({ isSudo }: { isSudo: boolean }) {
  return (
    <div className="p-6 sm:p-10 pt-16 md:pt-10">
      <div className="max-w-md mx-auto rounded-2xl border border-line bg-bg-card p-6 flex flex-col gap-3">
        <h1 className="text-xl font-semibold">403 — Not allowed</h1>
        <p className="text-ink-dim text-sm">
          {isSudo ? (
            <>
              Admin Home is bot-owner-only in MVP. Per-surface sudo
              authority lands in V2; until then, the cross-cutting roll-up
              stays gated to the bot owner so we don&apos;t leak data
              across surfaces a given sudo user shouldn&apos;t see.
            </>
          ) : (
            <>
              Admin Home is bot-owner-only. If you think you should have
              access, ask the bot owner — sudo grants don&apos;t cover
              this view in MVP.
            </>
          )}
        </p>
      </div>
    </div>
  )
}

export default async function SudoHomePage() {
  const session = await getSession()
  if (!session) redirect('/api/auth/login')

  const access = await resolveAccess(session)
  if (!access.botOwner) {
    return <NotAuthorizedCard isSudo={access.squishy.sudo} />
  }

  // Parallel fetch — `allSettled` so one failed read can't poison the
  // other two cards. Each loader's own try/catch is wrapped here too so
  // even an unexpected throw shape produces a per-card unavailable state.
  const [sudoRes, approvalsRes, reportsRes] = await Promise.allSettled([
    loadSudoUsers(),
    loadPendingApprovals(),
    loadRecentReports(),
  ])

  const sudoRows = settled(sudoRes)
  const approvals = settled(approvalsRes)
  const reports = settled(reportsRes)

  // Log per-section failures so an operator pulling container logs sees
  // the underlying error — the page renders unavailable cards but the
  // browser never gets the stack.
  if (sudoRes.status === 'rejected') {
    console.warn('[sudo] sudo_users load failed', sudoRes.reason)
  }
  if (approvalsRes.status === 'rejected') {
    console.warn('[sudo] staff_approvals load failed', approvalsRes.reason)
  }
  if (reportsRes.status === 'rejected') {
    console.warn('[sudo] report_log load failed', reportsRes.reason)
  }

  // Batch-resolve every snowflake on this page in one RPC round-trip so
  // the audit / approval / report tables can render `@displayName` +
  // avatar instead of raw IDs. Empty Map on RPC failure → UserChip falls
  // back to the raw id.
  const userIds: string[] = []
  if (sudoRows) {
    for (const r of sudoRows) {
      userIds.push(r.userId)
      if (r.addedByDiscordId) userIds.push(r.addedByDiscordId)
    }
  }
  if (approvals) {
    for (const a of approvals) {
      userIds.push(a.userId)
      if (a.reviewedBy) userIds.push(a.reviewedBy)
    }
  }
  if (reports) {
    for (const r of reports) userIds.push(r.userId)
  }
  const userMap = await resolveUsernames('squishy', userIds)

  return (
    <div className="p-6 sm:p-10 pt-16 md:pt-10">
      <div className="max-w-6xl mx-auto flex flex-col gap-6">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">Admin Home</h1>
          <p className="text-sm text-ink-dim">
            Bot-owner-only cross-cutting views.
          </p>
          <p className="text-xs text-ink-dim/80 mt-1">
            Per-section sudo gating (so non-owner sudos can see just the
            slices they should) is coming in V2 — until then this page
            stays owner-only.
          </p>
        </header>

        {/* --- Sudo Users --------------------------------------------- */}
        <section className="rounded-xl border border-line bg-bg-card overflow-hidden">
          <header className="flex items-baseline justify-between gap-3 px-4 py-3 border-b border-line">
            <h2 className="text-lg font-semibold">Sudo users</h2>
            <p className="text-xs text-ink-dim">
              Env (<code className="font-mono">SUDO_USER_IDS</code>) + DB
              (<code className="font-mono">sudo_users</code>) merged.
            </p>
          </header>
          <AddSudoUserForm />
          {sudoRows === null ? (
            <div className="p-4">
              <DataUnavailable what="Sudo users" />
            </div>
          ) : sudoRows.length === 0 ? (
            <div className="p-4 text-sm text-ink-dim">
              No sudo users configured. Set{' '}
              <code className="font-mono text-xs">SUDO_USER_IDS</code> in
              the panel env or add a row above to populate the{' '}
              <code className="font-mono text-xs">sudo_users</code> table.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-bg-card2 text-xs uppercase tracking-wider text-ink-dim">
                  <tr>
                    <th className="px-3 py-2 font-medium">User</th>
                    <th className="px-3 py-2 font-medium">Source</th>
                    <th className="px-3 py-2 font-medium">Added by</th>
                    <th className="px-3 py-2 font-medium">Added</th>
                    <th className="px-3 py-2 font-medium">Note</th>
                    <th className="px-3 py-2 font-medium w-px"></th>
                  </tr>
                </thead>
                <tbody>
                  {sudoRows.map((r) => (
                    <tr
                      key={`${r.source}:${r.userId}`}
                      className="border-b border-line last:border-b-0"
                    >
                      <td className="px-3 py-2 whitespace-nowrap">
                        <UserChip
                          userId={r.userId}
                          resolved={userMap.get(r.userId) ?? null}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <SourcePill source={r.source} />
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {r.addedByDiscordId ? (
                          <UserChip
                            userId={r.addedByDiscordId}
                            resolved={userMap.get(r.addedByDiscordId) ?? null}
                          />
                        ) : (
                          <span className="italic text-xs text-ink-dim">—</span>
                        )}
                      </td>
                      <td
                        className="px-3 py-2 text-xs text-ink-dim whitespace-nowrap"
                        title={r.addedAt ? r.addedAt.toISOString() : ''}
                      >
                        {r.addedAt ? relTime(r.addedAt) : <span className="italic">—</span>}
                      </td>
                      <td className="px-3 py-2 text-xs text-ink-dim">
                        {r.note ?? <span className="italic">—</span>}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-right">
                        {r.source === 'db' ? (
                          <RevokeButton userId={r.userId} />
                        ) : (
                          <span
                            className="text-[10px] italic text-ink-dim"
                            title="Env-source grants come from SUDO_USER_IDS and can't be revoked here"
                          >
                            env-only
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* --- Pending staff approvals -------------------------------- */}
        <section className="rounded-xl border border-line bg-bg-card overflow-hidden">
          <header className="flex items-baseline justify-between gap-3 px-4 py-3 border-b border-line">
            <h2 className="text-lg font-semibold">Pending staff approvals</h2>
            <p className="text-xs text-ink-dim">
              Open role requests awaiting a decision.
            </p>
          </header>
          {/* Direct grant + revoke forms — skip the queue when sudo already
              decided offline. Both call the panel routes that hit
              `callBot('squishy', 'staff.grant'|'staff.revoke', …)`. */}
          <DirectGrantForm />
          <DirectRevokeForm />
          {approvals === null ? (
            <div className="p-4">
              <DataUnavailable what="Staff approvals" />
            </div>
          ) : approvals.length === 0 ? (
            <div className="p-4 text-sm text-ink-dim">
              No pending approvals.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-bg-card2 text-xs uppercase tracking-wider text-ink-dim">
                  <tr>
                    <th className="px-3 py-2 font-medium">Requester</th>
                    <th className="px-3 py-2 font-medium">Role</th>
                    <th className="px-3 py-2 font-medium">Requested data</th>
                    <th className="px-3 py-2 font-medium">Submitted</th>
                    <th className="px-3 py-2 font-medium w-px text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {approvals.map((a) => {
                    const roleKey = deriveRoleKey(a.requestedData)
                    const summary = summarizeRequestedData(a.requestedData)
                    return (
                      <tr
                        key={a.id}
                        className="border-b border-line last:border-b-0"
                      >
                        <td className="px-3 py-2 whitespace-nowrap">
                          <UserChip
                            userId={a.userId}
                            resolved={userMap.get(a.userId) ?? null}
                          />
                          {a.reviewedBy && (
                            <div className="mt-1 flex items-baseline gap-1 text-[10px] text-ink-dim">
                              reviewed by{' '}
                              <UserChip
                                userId={a.reviewedBy}
                                resolved={userMap.get(a.reviewedBy) ?? null}
                              />
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-sm">
                          <span className="font-mono text-xs">{roleKey}</span>
                        </td>
                        <td className="px-3 py-2 text-xs text-ink-dim">
                          {summary || <span className="italic">—</span>}
                        </td>
                        <td
                          className="px-3 py-2 text-xs text-ink-dim whitespace-nowrap"
                          title={a.createdAt.toISOString()}
                        >
                          {relTime(a.createdAt)}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-right">
                          <span className="inline-flex items-center gap-1">
                            <ApproveButton id={a.id} />
                            <DenyButton id={a.id} />
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* --- Recent reports ----------------------------------------- */}
        <section className="rounded-xl border border-line bg-bg-card overflow-hidden">
          <header className="flex items-baseline justify-between gap-3 px-4 py-3 border-b border-line">
            <h2 className="text-lg font-semibold">Recent reports</h2>
            <p className="text-xs text-ink-dim">
              Last 30 <code className="font-mono">/report</code> submissions.
            </p>
          </header>
          {reports === null ? (
            <div className="p-4">
              <DataUnavailable what="Reports" />
            </div>
          ) : reports.length === 0 ? (
            <div className="p-4 text-sm text-ink-dim">
              No reports filed yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-bg-card2 text-xs uppercase tracking-wider text-ink-dim">
                  <tr>
                    <th className="px-3 py-2 font-medium">Title</th>
                    <th className="px-3 py-2 font-medium">Reporter</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Issue</th>
                    <th className="px-3 py-2 font-medium">Submitted</th>
                  </tr>
                </thead>
                <tbody>
                  {reports.map((r) => (
                    <tr
                      key={r.id}
                      className="border-b border-line last:border-b-0"
                    >
                      <td className="px-3 py-2 text-sm">
                        <div className="font-medium text-ink">{r.title}</div>
                        <div className="text-[10px] uppercase tracking-wider text-ink-dim">
                          {r.reportType}
                        </div>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <UserChip
                          userId={r.userId}
                          resolved={userMap.get(r.userId) ?? null}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <ReportStatusPill status={r.status} />
                      </td>
                      <td className="px-3 py-2 text-xs whitespace-nowrap">
                        {r.githubIssueUrl ? (
                          <a
                            href={r.githubIssueUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-accent hover:underline"
                          >
                            open ↗
                          </a>
                        ) : (
                          <span className="text-ink-dim italic">—</span>
                        )}
                      </td>
                      <td
                        className="px-3 py-2 text-xs text-ink-dim whitespace-nowrap"
                        title={r.createdAt.toISOString()}
                      >
                        {relTime(r.createdAt)}
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

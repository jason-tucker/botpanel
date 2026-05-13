/**
 * /squishy/approvals — sudo Pending Approvals dashboard.
 *
 * Mirrors the `/sudo → Pending approvals` slash button. Read-only listing
 * for now: shows every pending `staff_approvals` row for Squishy's guild
 * with requester, requested department/tier, real name, and created-at.
 *
 * Action (approve / deny) still lives in Discord on the approval card —
 * a future iteration adds `staff.approve_request` / `staff.deny_request`
 * RPC verbs and inline buttons here. The current value is visibility:
 * sudos can see what's outstanding from the dashboard without opening
 * Discord.
 *
 * Gate: sudo or bot-owner. Non-sudo viewers get a 403 card.
 */
import { redirect } from 'next/navigation'
import { and, desc, eq } from 'drizzle-orm'
import Link from 'next/link'
import { getSession } from '@/lib/auth/session'
import { resolveAccess } from '@/lib/auth/perms'
import { squishyDb, squishySchema } from '@/lib/db/squishy'
import { env } from '@/lib/env'
import { labelForDepartment, labelForTier } from '@/lib/squishyStaffRoles'
import { UserChip } from '@/components/UserChip'
import { resolveUsernames } from '@/lib/userDisplay'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Pending = {
  id: string
  userId: string
  departmentLabel: string | null
  tierLabel: string | null
  realName: string | null
  createdAt: Date
}

async function loadAllPendingApprovals(guildId: string): Promise<Pending[]> {
  try {
    const rows = await squishyDb
      .select({
        id: squishySchema.staffApprovals.id,
        userId: squishySchema.staffApprovals.userId,
        requestedData: squishySchema.staffApprovals.requestedData,
        createdAt: squishySchema.staffApprovals.createdAt,
      })
      .from(squishySchema.staffApprovals)
      .where(
        and(
          eq(squishySchema.staffApprovals.guildId, guildId),
          eq(squishySchema.staffApprovals.status, 'pending'),
        ),
      )
      .orderBy(desc(squishySchema.staffApprovals.createdAt))
    return rows.map((r) => {
      const d = (r.requestedData ?? {}) as {
        department_key?: string | null
        department_label?: string | null
        tier_key?: string | null
        tier_label?: string | null
        role_key?: string
        role_label?: string
        real_name?: string | null
      }
      let departmentLabel: string | null = null
      let tierLabel: string | null = null
      if (d.department_key) {
        const slug = d.department_key.replace(/^staff\.role\./, '')
        departmentLabel = d.department_label ?? labelForDepartment(slug) ?? slug
      }
      if (d.tier_key) {
        const slug = d.tier_key.replace(/^staff\.role\./, '')
        tierLabel = d.tier_label ?? labelForTier(slug) ?? slug
      }
      if (!departmentLabel && !tierLabel && d.role_key) {
        const slug = d.role_key.replace(/^staff\.role\./, '')
        const tierGuess = labelForTier(slug)
        if (tierGuess) tierLabel = d.role_label ?? tierGuess
        else departmentLabel = d.role_label ?? labelForDepartment(slug) ?? slug
      }
      return {
        id: r.id,
        userId: r.userId,
        departmentLabel,
        tierLabel,
        realName: d.real_name ?? null,
        createdAt: r.createdAt,
      }
    })
  } catch (err) {
    console.warn('[squishy/approvals] load failed', err)
    return []
  }
}

function relTime(d: Date): string {
  const ms = Date.now() - d.getTime()
  const m = Math.floor(ms / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export default async function ApprovalsPage() {
  const session = await getSession()
  if (!session) redirect('/api/auth/login')
  const access = await resolveAccess(session)
  const allowed = access.squishy.sudo || access.botOwner

  if (!allowed) {
    return (
      <main className="min-h-dvh p-6 sm:p-10">
        <div className="max-w-md mx-auto rounded-2xl border border-line bg-bg-card p-6 flex flex-col gap-3">
          <h1 className="text-xl font-semibold">Sudo only</h1>
          <p className="text-ink-dim text-sm">
            Pending staff-request approvals are sudo-only.
          </p>
          <Link href="/me" className="text-sm text-accent underline self-start">
            ← Back to dashboard
          </Link>
        </div>
      </main>
    )
  }

  const pending = await loadAllPendingApprovals(env.GUILD_ID)
  const userIds = Array.from(new Set(pending.map((p) => p.userId)))
  const usernames = await resolveUsernames('squishy', userIds)

  return (
    <main className="min-h-dvh p-6 sm:p-10 pt-16 md:pt-10">
      <div className="max-w-4xl mx-auto flex flex-col gap-6">
        <header>
          <h1 className="text-2xl font-semibold">
            <code className="font-mono">/sudo</code> → Pending Approvals
          </h1>
          <p className="text-sm text-ink-dim mt-1 max-w-2xl">
            Staff-role requests waiting for review. Approve / deny still
            happens in Discord on the approval card (panel-side action buttons
            land in a follow-up PR) — for now this is the dashboard view of
            what&apos;s outstanding.
          </p>
        </header>

        {pending.length === 0 ? (
          <section className="rounded-2xl border border-line bg-bg-card p-6">
            <p className="text-sm text-ink-dim">No pending requests. ✓</p>
          </section>
        ) : (
          <section className="rounded-2xl border border-line bg-bg-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-bg-card2 text-[10px] uppercase tracking-wider text-ink-dim">
                  <tr>
                    <th className="px-4 py-3 font-medium">Requester</th>
                    <th className="px-4 py-3 font-medium">Department</th>
                    <th className="px-4 py-3 font-medium">Tier</th>
                    <th className="px-4 py-3 font-medium">Real name</th>
                    <th className="px-4 py-3 font-medium">Submitted</th>
                  </tr>
                </thead>
                <tbody>
                  {pending.map((p) => {
                    const u = usernames.get(p.userId) ?? null
                    return (
                      <tr
                        key={p.id}
                        className="border-b border-line/60 last:border-b-0 hover:bg-bg-card2/40"
                      >
                        <td className="px-4 py-3">
                          <UserChip userId={p.userId} resolved={u} />
                        </td>
                        <td className="px-4 py-3 text-ink">
                          {p.departmentLabel ?? <span className="text-ink-dim">—</span>}
                        </td>
                        <td className="px-4 py-3 text-ink">
                          {p.tierLabel ?? <span className="text-ink-dim">—</span>}
                        </td>
                        <td className="px-4 py-3 text-ink-dim text-xs max-w-[16ch] truncate">
                          {p.realName ?? '—'}
                        </td>
                        <td className="px-4 py-3 text-ink-dim text-xs">
                          {relTime(p.createdAt)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </main>
  )
}

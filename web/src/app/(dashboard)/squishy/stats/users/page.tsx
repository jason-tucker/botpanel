/**
 * /squishy/stats/users — full member activity leaderboard.
 *
 * Sudo / bot-owner only. Ranked by the same blended messages+voice score
 * used for the overview's "Top members" BarList, just with a longer list
 * and more columns. Range-only control (no per-page timezone/metric — the
 * table doesn't have a heatmap to shift).
 */
import Link from 'next/link'
import Image from 'next/image'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/session'
import { resolveAccess } from '@/lib/auth/perms'
import { getViewAsUserId } from '@/lib/auth/viewAs'
import { relTime } from '@/lib/util/format'
import {
  STATS_RANGES,
  STATS_RANGE_LABELS,
  normalizeRange,
  getStatsEnabledState,
  getUserLeaderboard,
  resolveDisplayNames,
  type StatsRange,
} from '@/lib/stats/squishy'
import { PageHeader, EmptyState, Card, CardBody } from '@/components/ui'

export const dynamic = 'force-dynamic'

const LIMIT = 100

function formatHours(seconds: number): string {
  return `${(seconds / 3600).toFixed(1)}h`
}

export default async function SquishyStatsUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>
}) {
  const session = await getSession()
  if (!session) redirect('/')

  const viewAsUserId = await getViewAsUserId()
  const access = await resolveAccess(session, viewAsUserId ? { viewAsUserId } : undefined)
  const allowed = access.botOwner || access.squishy.sudo
  if (!allowed) redirect(`/squishy/stats/users/${access.viewing.id}`)

  const sp = await searchParams
  const range: StatsRange = normalizeRange(sp.range)

  const state = await getStatsEnabledState()
  if (!state.enabled) {
    return (
      <div className="p-6 sm:p-10 pt-16 md:pt-10">
        <div className="mx-auto flex max-w-3xl flex-col gap-6">
          <PageHeader icon="stats" eyebrow="Squishy" title="Member leaderboard" description="Activity Stats is currently disabled." />
          <Card>
            <CardBody>
              <EmptyState
                icon="stats"
                title="Activity Stats is off"
                description="An owner or sudo needs to enable tracking before any leaderboard data exists."
                action={
                  <Link href="/squishy/stats" className="text-sm text-accent hover:underline">
                    Go to Activity Stats →
                  </Link>
                }
              />
            </CardBody>
          </Card>
        </div>
      </div>
    )
  }

  const rows = await getUserLeaderboard(range, LIMIT)
  const displayMap = await resolveDisplayNames(rows.map((r) => r.userId))

  return (
    <main className="min-h-dvh p-6 sm:p-10 pt-16 md:pt-10">
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <PageHeader
          icon="stats"
          eyebrow="Squishy"
          title="Member leaderboard"
          description="Ranked by blended message + voice activity."
          actions={
            <div className="inline-flex items-center gap-1 rounded-lg border border-line bg-bg-card2 p-1">
              {STATS_RANGES.map((r) => (
                <Link
                  key={r}
                  href={`/squishy/stats/users?range=${r}`}
                  className={
                    r === range
                      ? 'rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-white'
                      : 'rounded-md px-2.5 py-1 text-xs text-ink-dim transition-colors hover:bg-bg-hover hover:text-ink'
                  }
                >
                  {STATS_RANGE_LABELS[r]}
                </Link>
              ))}
            </div>
          }
        />

        <div className="flex items-center justify-between">
          <Link href="/squishy/stats" className="text-sm text-ink-dim hover:text-ink">
            ← Activity Stats
          </Link>
        </div>

        {rows.length === 0 ? (
          <Card>
            <CardBody>
              <EmptyState icon="users" title="No activity yet" description="No members have messaged or joined voice in this range." />
            </CardBody>
          </Card>
        ) : (
          <div className="overflow-hidden rounded-xl border border-line bg-bg-card">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-bg-card2 text-xs uppercase tracking-wider text-ink-dim">
                  <tr>
                    <th className="px-3 py-2 font-medium">#</th>
                    <th className="px-3 py-2 font-medium">Member</th>
                    <th className="px-3 py-2 font-medium text-right">Messages</th>
                    <th className="px-3 py-2 font-medium text-right">Voice</th>
                    <th className="px-3 py-2 font-medium">Last active</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const info = displayMap.get(r.userId)
                    return (
                      <tr key={r.userId} className="border-b border-line last:border-b-0 hover:bg-bg-card2/30">
                        <td className="px-3 py-2 text-sm text-ink-dim tabular-nums">{i + 1}</td>
                        <td className="px-3 py-2">
                          <Link href={`/squishy/stats/users/${r.userId}`} className="inline-flex items-center gap-2 hover:underline">
                            {info?.avatarUrl ? (
                              <Image src={info.avatarUrl} alt="" width={24} height={24} className="h-6 w-6 rounded-full border border-line" />
                            ) : (
                              <span className="flex h-6 w-6 items-center justify-center rounded-full border border-line bg-bg-card2 text-[10px] text-ink-dim">
                                {(info?.name ?? r.userId).slice(0, 1).toUpperCase()}
                              </span>
                            )}
                            <span className="text-sm text-ink">{info?.name ?? r.userId}</span>
                          </Link>
                        </td>
                        <td className="px-3 py-2 text-right text-sm tabular-nums">{r.messages.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right text-sm tabular-nums">{r.voiceSeconds > 0 ? formatHours(r.voiceSeconds) : '—'}</td>
                        <td className="px-3 py-2 text-xs text-ink-dim whitespace-nowrap" title={r.lastActive?.toISOString()}>
                          {r.lastActive ? relTime(r.lastActive) : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {rows.length === LIMIT && (
              <div className="border-t border-line bg-bg-card2/40 px-3 py-2 text-[11px] text-ink-dim">
                Showing the top {LIMIT} members for this range.
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  )
}

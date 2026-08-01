/**
 * /squishy/stats/auto-voice — breakdown behind the "Auto voice rooms" group.
 *
 * Auto voice rooms (and their companion text channels) are ephemeral — the
 * pair is deleted as soon as the room empties — so the main channel
 * leaderboard folds every kind-tagged row into one group entry instead of
 * listing dead channel IDs. This page is that group's drill-down: every
 * room that saw activity in range (name captured at write time, so deleted
 * rooms still render properly), its companion text chats, and the top
 * members across all of them.
 *
 * Sudo / bot-owner only, same as the per-channel detail page.
 */
import Link from 'next/link'
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
  getAutoVoiceRooms,
  getAutoGroupTopUsers,
  resolveDisplayNames,
  AUTO_GROUP_LABEL,
  type StatsRange,
  type AutoVoiceRoomRow,
} from '@/lib/stats/squishy'
import { PageHeader, StatCard, Card, CardHeader, CardTitle, CardDescription, CardBody, EmptyState, Badge, BarList } from '@/components/ui'

export const dynamic = 'force-dynamic'

function formatHours(seconds: number): string {
  return `${(seconds / 3600).toFixed(1)}h`
}

function ForbiddenCard() {
  return (
    <main className="min-h-dvh p-6 sm:p-10">
      <div className="mx-auto flex max-w-md flex-col gap-3 rounded-2xl border border-line bg-bg-card p-6">
        <h1 className="text-xl font-semibold">403 — Not allowed</h1>
        <p className="text-sm text-ink-dim">
          Channel-level activity is sudo-only. Ask the bot owner to add you to{' '}
          <code className="font-mono text-xs">SUDO_USER_IDS</code> or the{' '}
          <code className="font-mono text-xs">sudo_users</code> table.
        </p>
        <Link href="/squishy/stats" className="self-start text-sm text-accent underline">
          ← Back to Activity Stats
        </Link>
      </div>
    </main>
  )
}

function roomLabel(r: AutoVoiceRoomRow) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <span className="truncate">{r.channelName ?? <span className="font-mono text-xs">{r.channelId}</span>}</span>
      {r.live && (
        <Badge tone="success" dot>
          live
        </Badge>
      )}
    </span>
  )
}

function roomHint(r: AutoVoiceRoomRow): string {
  const parts: string[] = []
  if (r.voiceSeconds > 0) parts.push(`${formatHours(r.voiceSeconds)} voice`)
  if (r.messages > 0) parts.push(`${r.messages.toLocaleString('en-US')} msgs`)
  parts.push(`${r.userCount} member${r.userCount === 1 ? '' : 's'}`)
  if (r.lastActive) parts.push(`active ${relTime(r.lastActive)}`)
  return parts.join(' · ')
}

export default async function SquishyAutoVoiceStatsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>
}) {
  const session = await getSession()
  if (!session) redirect('/')

  const viewAsUserId = await getViewAsUserId()
  const access = await resolveAccess(session, viewAsUserId ? { viewAsUserId } : undefined)
  const allowed = access.botOwner || access.squishy.sudo
  if (!allowed) return <ForbiddenCard />

  const sp = await searchParams
  const range: StatsRange = normalizeRange(sp.range)

  const state = await getStatsEnabledState()
  if (!state.enabled) {
    return (
      <div className="p-6 sm:p-10 pt-16 md:pt-10">
        <div className="mx-auto flex max-w-3xl flex-col gap-6">
          <PageHeader icon="voice" eyebrow="Squishy · Activity" title={AUTO_GROUP_LABEL} description="Activity Stats is currently disabled." />
          <Card>
            <CardBody>
              <EmptyState
                icon="stats"
                title="Activity Stats is off"
                description="An owner or sudo needs to enable tracking before any room data exists."
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

  const [summary, topUsers] = await Promise.all([getAutoVoiceRooms(range), getAutoGroupTopUsers(range, 10)])
  const displayMap = await resolveDisplayNames(topUsers.map((u) => u.userId))
  const liveCount = summary.rooms.filter((r) => r.live).length

  return (
    <div className="p-6 sm:p-10 pt-16 md:pt-10">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <PageHeader
          icon="voice"
          eyebrow="Squishy · Activity"
          title={AUTO_GROUP_LABEL}
          description="Every ephemeral voice room that saw activity — rooms are deleted when they empty, so their stats live on here instead of as ghost channels."
          actions={
            <div className="inline-flex items-center gap-1 rounded-lg border border-line bg-bg-card2 p-1">
              {STATS_RANGES.map((r) => (
                <Link
                  key={r}
                  href={`/squishy/stats/auto-voice?range=${r}`}
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

        <div>
          <Link href="/squishy/stats" className="text-sm text-ink-dim hover:text-ink">
            ← Activity Stats
          </Link>
        </div>

        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="Rooms"
            value={summary.totals.roomCount.toLocaleString()}
            hint={liveCount > 0 ? `${liveCount} open right now` : 'created & deleted on demand'}
            icon="voice"
            tone="accent"
          />
          <StatCard label="Voice time" value={formatHours(summary.totals.voiceSeconds)} hint={STATS_RANGE_LABELS[range]} icon="voice" tone="success" />
          <StatCard label="Messages" value={summary.totals.messages.toLocaleString()} hint="room + companion chats" icon="activity" tone="info" />
          <StatCard label="Members" value={summary.totals.userCount.toLocaleString()} hint="used a room in range" icon="users" tone="warning" />
        </section>

        <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Rooms</CardTitle>
                <CardDescription>By voice time — names as last seen before deletion</CardDescription>
              </div>
            </CardHeader>
            <CardBody>
              {summary.rooms.length === 0 ? (
                <p className="text-sm text-ink-dim">No room activity in this range.</p>
              ) : (
                <BarList
                  color="accent"
                  items={summary.rooms.slice(0, 25).map((r) => ({
                    label: roomLabel(r),
                    value: Math.round(r.voiceSeconds / 60),
                    hint: roomHint(r),
                    href: `/squishy/stats/channels/${r.channelId}`,
                  }))}
                  formatValue={(v) => formatHours(v * 60)}
                />
              )}
              {summary.rooms.length > 25 && (
                <p className="mt-3 text-xs text-ink-faint">Showing the top 25 of {summary.rooms.length} rooms.</p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Room text chats</CardTitle>
                <CardDescription>Companion text channels, by messages</CardDescription>
              </div>
            </CardHeader>
            <CardBody>
              {summary.chats.length === 0 ? (
                <p className="text-sm text-ink-dim">No companion-chat activity in this range.</p>
              ) : (
                <BarList
                  color="aqua"
                  items={summary.chats.slice(0, 25).map((r) => ({
                    label: roomLabel(r),
                    value: r.messages,
                    hint: roomHint(r),
                    href: `/squishy/stats/channels/${r.channelId}`,
                  }))}
                />
              )}
              {summary.chats.length > 25 && (
                <p className="mt-3 text-xs text-ink-faint">Showing the top 25 of {summary.chats.length} chats.</p>
              )}
            </CardBody>
          </Card>
        </section>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Top members</CardTitle>
              <CardDescription>Blended activity across all rooms and chats — messages + voice minutes</CardDescription>
            </div>
          </CardHeader>
          <CardBody>
            {topUsers.length === 0 ? (
              <p className="text-sm text-ink-dim">No member activity in rooms yet.</p>
            ) : (
              <BarList
                color="accent"
                items={topUsers.map((u) => {
                  const info = displayMap.get(u.userId)
                  return {
                    label: info?.name ?? u.userId,
                    value: Math.round(u.messages + u.voiceSeconds / 60),
                    hint: `${u.messages.toLocaleString('en-US')} msgs${u.voiceSeconds > 0 ? ` · ${formatHours(u.voiceSeconds)} voice` : ''}`,
                    href: `/squishy/stats/users/${u.userId}`,
                  }
                })}
              />
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  )
}

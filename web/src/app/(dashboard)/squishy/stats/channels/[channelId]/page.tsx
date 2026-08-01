/**
 * /squishy/stats/channels/[channelId] — per-channel activity detail.
 *
 * Sudo / bot-owner only (unlike the per-user page, there's no "this is my
 * own channel" self-access case). `channelName` comes from the captured
 * `channel_name` column on the activity tables (most recent non-null value)
 * since many tracked channels — auto-voice text channels, threads — get
 * deleted and their IDs become unresolvable via Discord; falls back to the
 * raw id when nothing was ever captured (e.g. zero activity in range).
 */
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { getSession } from '@/lib/auth/session'
import { resolveAccess } from '@/lib/auth/perms'
import { getViewAsUserId } from '@/lib/auth/viewAs'
import { discordChannelUrl } from '@/lib/util/format'
import { env } from '@/lib/env'
import {
  STATS_RANGES,
  STATS_RANGE_LABELS,
  tzChips,
  tzLabel,
  normalizeRange,
  normalizeTz,
  normalizeMetric,
  getStatsEnabledState,
  getChannelStats,
  resolveDisplayNames,
  type StatsRange,
  type StatsTz,
  type StatsMetric,
} from '@/lib/stats/squishy'
import { PageHeader, StatCard, Card, CardHeader, CardTitle, CardDescription, CardBody, EmptyState, Heatmap, BarList, Icon, Badge } from '@/components/ui'

export const dynamic = 'force-dynamic'

const SNOWFLAKE_RE = /^\d{15,25}$/

function formatHours(seconds: number): string {
  return `${(seconds / 3600).toFixed(1)}h`
}

function qs(base: { range: string; tz: string; metric: string }, override: Partial<typeof base>): string {
  const merged = { ...base, ...override }
  const sp = new URLSearchParams()
  sp.set('range', merged.range)
  sp.set('tz', merged.tz)
  sp.set('metric', merged.metric)
  return `?${sp.toString()}`
}

function ForbiddenCard() {
  return (
    <main className="min-h-dvh p-6 sm:p-10">
      <div className="mx-auto flex max-w-md flex-col gap-3 rounded-2xl border border-line bg-bg-card p-6">
        <h1 className="text-xl font-semibold">403 — Not allowed</h1>
        <p className="text-sm text-ink-dim">
          Per-channel activity is sudo-only. Ask the bot owner to add you to{' '}
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

function NotFoundCard() {
  return (
    <main className="min-h-dvh p-6 sm:p-10">
      <div className="mx-auto flex max-w-md flex-col gap-3 rounded-2xl border border-line bg-bg-card p-6">
        <h1 className="text-xl font-semibold">404 — Not a Discord snowflake</h1>
        <p className="text-sm text-ink-dim">
          The id in the URL doesn&apos;t look like a Discord channel id (15-25 digits).
        </p>
        <Link href="/squishy/stats" className="self-start text-sm text-accent underline">
          ← Back to Activity Stats
        </Link>
      </div>
    </main>
  )
}

export default async function SquishyStatsChannelDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ channelId: string }>
  searchParams: Promise<{ range?: string; tz?: string; metric?: string }>
}) {
  const session = await getSession()
  if (!session) redirect('/')

  const { channelId } = await params
  if (!SNOWFLAKE_RE.test(channelId)) return <NotFoundCard />

  const viewAsUserId = await getViewAsUserId()
  const access = await resolveAccess(session, viewAsUserId ? { viewAsUserId } : undefined)
  const allowed = access.botOwner || access.squishy.sudo
  if (!allowed) return <ForbiddenCard />

  const sp = await searchParams
  const range: StatsRange = normalizeRange(sp.range)
  const tz: StatsTz = normalizeTz(sp.tz, (await cookies()).get('stats_tz')?.value)
  const metric: StatsMetric = normalizeMetric(sp.metric)
  const base = { range, tz, metric }

  const state = await getStatsEnabledState()
  if (!state.enabled) {
    return (
      <div className="p-6 sm:p-10 pt-16 md:pt-10">
        <div className="mx-auto flex max-w-3xl flex-col gap-6">
          <PageHeader icon="stats" eyebrow="Squishy" title="Channel activity" description="Activity Stats is currently disabled." />
          <Card>
            <CardBody>
              <EmptyState
                icon="stats"
                title="Activity Stats is off"
                description="An owner or sudo needs to enable tracking before any channel data exists."
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

  const stats = await getChannelStats(channelId, range, tz, metric)
  const displayMap = await resolveDisplayNames(stats.topUsers.map((u) => u.userId))
  const maxHeatmap = stats.heatmap.reduce((m, c) => Math.max(m, c.value), 0)
  const channelUrl = discordChannelUrl(env.GUILD_ID ?? null, channelId)

  return (
    <div className="p-6 sm:p-10 pt-16 md:pt-10">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <PageHeader
          icon="stats"
          eyebrow="Squishy · Activity"
          title={stats.channelName ?? channelId}
          description={
            <span className="inline-flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs">{channelId}</span>
              {stats.channelKind && (
                // Ephemeral auto channel — say what it is/was instead of
                // leaving a dead Discord link as the only context.
                <Badge tone={stats.liveAutoChannel ? 'success' : 'neutral'} dot={stats.liveAutoChannel}>
                  {stats.channelKind === 'auto_text' ? 'room text chat' : 'auto voice room'}
                  {stats.liveAutoChannel ? ' · open' : ' · deleted'}
                </Badge>
              )}
              {stats.channelKind && (
                <Link href="/squishy/stats/auto-voice" className="text-accent hover:underline">
                  All rooms →
                </Link>
              )}
              {channelUrl && (!stats.channelKind || stats.liveAutoChannel) && (
                <a href={channelUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
                  Open in Discord <Icon name="external" size={12} />
                </a>
              )}
            </span>
          }
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center gap-1 rounded-lg border border-line bg-bg-card2 p-1">
                {STATS_RANGES.map((r) => (
                  <Link
                    key={r}
                    href={`/squishy/stats/channels/${channelId}${qs(base, { range: r })}`}
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
              <div className="inline-flex items-center gap-1 rounded-lg border border-line bg-bg-card2 p-1">
                {tzChips(tz).map((t) => (
                  <Link
                    key={t}
                    href={`/squishy/stats/channels/${channelId}${qs(base, { tz: t })}`}
                    className={
                      t === tz
                        ? 'rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-white'
                        : 'rounded-md px-2.5 py-1 text-xs text-ink-dim transition-colors hover:bg-bg-hover hover:text-ink'
                    }
                  >
                    {tzLabel(t)}
                  </Link>
                ))}
              </div>
            </div>
          }
        />

        <div>
          <Link href="/squishy/stats" className="text-sm text-ink-dim hover:text-ink">
            ← Activity Stats
          </Link>
        </div>

        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Messages" value={stats.totals.messages.toLocaleString()} hint={STATS_RANGE_LABELS[range]} icon="activity" tone="accent" />
          <StatCard label="Voice" value={formatHours(stats.totals.voiceSeconds)} hint="total time in channel" icon="voice" tone="success" />
          <StatCard
            label="Top members"
            value={stats.topUsers.length.toLocaleString()}
            hint={stats.topUsers.length >= 10 ? 'shown below (list capped at 10)' : 'posted or voice-chatted'}
            icon="users"
            tone="info"
          />
          <StatCard
            label="Top member"
            value={stats.topUsers[0] ? (displayMap.get(stats.topUsers[0].userId)?.name ?? stats.topUsers[0].userId) : '—'}
            hint={stats.topUsers[0] ? `${stats.topUsers[0].messages.toLocaleString()} messages` : 'no activity yet'}
            icon="star"
            tone="warning"
          />
        </section>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Activity heatmap</CardTitle>
              <CardDescription>
                {metric === 'voice' ? 'Voice minutes' : 'Messages'} by day of week &amp; hour, {tzLabel(tz)} time.
              </CardDescription>
            </div>
            <div className="inline-flex items-center gap-1 rounded-lg border border-line bg-bg-card2 p-1">
              <Link
                href={`/squishy/stats/channels/${channelId}${qs(base, { metric: 'messages' })}`}
                className={
                  metric === 'messages'
                    ? 'rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-white'
                    : 'rounded-md px-2.5 py-1 text-xs text-ink-dim transition-colors hover:bg-bg-hover hover:text-ink'
                }
              >
                Messages
              </Link>
              <Link
                href={`/squishy/stats/channels/${channelId}${qs(base, { metric: 'voice' })}`}
                className={
                  metric === 'voice'
                    ? 'rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-white'
                    : 'rounded-md px-2.5 py-1 text-xs text-ink-dim transition-colors hover:bg-bg-hover hover:text-ink'
                }
              >
                Voice
              </Link>
            </div>
          </CardHeader>
          <CardBody>
            {stats.heatmap.length === 0 ? (
              <p className="text-sm text-ink-dim">No {metric === 'voice' ? 'voice' : 'message'} activity recorded for this range.</p>
            ) : (
              <Heatmap
                cells={stats.heatmap}
                maxValue={maxHeatmap}
                color={metric === 'voice' ? 'aqua' : 'accent'}
                ariaLabel={`${metric === 'voice' ? 'Voice minutes' : 'Messages'} by day of week and hour for this channel`}
              />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Top members</CardTitle>
              <CardDescription>Blended activity — messages + voice minutes in this channel</CardDescription>
            </div>
          </CardHeader>
          <CardBody>
            {stats.topUsers.length === 0 ? (
              <p className="text-sm text-ink-dim">No member activity in this channel yet.</p>
            ) : (
              <BarList
                color="accent"
                items={stats.topUsers.map((u) => {
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

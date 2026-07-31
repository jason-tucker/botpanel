/**
 * /squishy/stats — Activity Stats overview.
 *
 * Sudo / bot-owner only (everyone else is redirected to their own
 * `/squishy/stats/users/[userId]`, mirroring `stats/me`). Server component;
 * every read goes through `@/lib/stats/squishy` which degrades gracefully
 * on DB trouble, so a partial outage renders a partial dashboard rather
 * than a 500.
 *
 * Two very different states:
 *  - Feature OFF (`feature.activity_stats` false in `bot_settings`) → a
 *    single prominent "enable" card explaining what gets collected (counts
 *    + voice sessions, never message content) and what backfill does.
 *  - Feature ON → the full dashboard: KPI grid, a metric-toggle heatmap,
 *    four BarLists (channels/users/games/emojis), a member-count TrendLine,
 *    and a backfill status + tracking-controls card.
 *
 * Range/timezone are plain querystring-driven `<Link>` chips (no client JS
 * needed for those) — `?range=7d|30d|90d|all&tz=<allowlisted>`. The
 * heatmap's message/voice metric toggle lives on the heatmap card itself
 * (`?metric=messages|voice`) since it only affects that one widget.
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
  STATS_TZ_ALLOWLIST,
  STATS_TZ_LABELS,
  normalizeRange,
  normalizeTz,
  normalizeMetric,
  getStatsEnabledState,
  getServerTotals,
  getServerHeatmap,
  getChannelLeaderboard,
  getUserLeaderboard,
  getTopGames,
  getTopEmojis,
  getMemberTrend,
  getBackfillSummary,
  resolveDisplayNames,
  type StatsRange,
  type StatsTz,
  type StatsMetric,
  type EmojiRow,
} from '@/lib/stats/squishy'
import { PageHeader, StatCard, Card, CardHeader, CardTitle, CardDescription, CardBody, Badge, Icon, Heatmap, BarList, TrendLine, type BadgeTone } from '@/components/ui'
import { EnableStatsButton, DisableStatsButton, BackfillToggleButton, ResetBackfillButton } from './StatsWriteUI'

export const dynamic = 'force-dynamic'

type SearchParams = { range?: string; tz?: string; metric?: string }

function qs(base: { range: string; tz: string; metric: string }, override: Partial<typeof base>): string {
  const merged = { ...base, ...override }
  const sp = new URLSearchParams()
  sp.set('range', merged.range)
  sp.set('tz', merged.tz)
  sp.set('metric', merged.metric)
  return `?${sp.toString()}`
}

function formatHours(seconds: number): string {
  return `${(seconds / 3600).toFixed(1)}h`
}

function ChipGroup({ children }: { children: React.ReactNode }) {
  return <div className="inline-flex items-center gap-1 rounded-lg border border-line bg-bg-card2 p-1">{children}</div>
}

function Chip({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={
        active
          ? 'rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-white'
          : 'rounded-md px-2.5 py-1 text-xs text-ink-dim transition-colors hover:bg-bg-hover hover:text-ink'
      }
    >
      {children}
    </Link>
  )
}

function EmojiLabel({ row }: { row: EmojiRow }) {
  if (row.custom) {
    return (
      <span className="inline-flex min-w-0 items-center gap-1.5">
        <Image
          src={`https://cdn.discordapp.com/emojis/${row.emojiKey}.png`}
          alt={row.emojiName ?? 'emoji'}
          width={16}
          height={16}
          className="h-4 w-4 flex-none rounded-sm"
        />
        <span className="truncate">{row.emojiName ?? row.emojiKey}</span>
      </span>
    )
  }
  return <span className="text-base leading-none">{row.emojiKey}</span>
}

const BACKFILL_STATUS_TONE: Record<string, BadgeTone> = {
  done: 'success',
  running: 'accent',
  pending: 'neutral',
  error: 'danger',
  skipped: 'warning',
}

export default async function SquishyStatsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await getSession()
  if (!session) redirect('/')

  const viewAsUserId = await getViewAsUserId()
  const access = await resolveAccess(session, viewAsUserId ? { viewAsUserId } : undefined)
  const allowed = access.botOwner || access.squishy.sudo
  if (!allowed) redirect(`/squishy/stats/users/${access.viewing.id}`)

  const sp = await searchParams
  const range: StatsRange = normalizeRange(sp.range)
  const tz: StatsTz = normalizeTz(sp.tz)
  const metric: StatsMetric = normalizeMetric(sp.metric)
  const base = { range, tz, metric }

  const state = await getStatsEnabledState()

  const header = (
    <PageHeader
      icon="stats"
      eyebrow="Squishy"
      title="Activity Stats"
      description="Server-wide engagement — messages, voice, games, reactions. Counts only, never message content."
    />
  )

  if (!state.enabled) {
    return (
      <div className="p-6 sm:p-10 pt-16 md:pt-10">
        <div className="mx-auto flex max-w-3xl flex-col gap-6">
          {header}
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Turn on Activity Stats</CardTitle>
                <CardDescription>Opt-in, off by default. Enable it below to start collecting.</CardDescription>
              </div>
              <span className="flex h-11 w-11 flex-none items-center justify-center rounded-2xl bg-accent-soft text-accent">
                <Icon name="stats" size={22} />
              </span>
            </CardHeader>
            <CardBody className="flex flex-col gap-5">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-line bg-bg-card2 p-3">
                  <div className="text-xs font-semibold uppercase tracking-wider text-ink-faint">What&apos;s collected</div>
                  <p className="mt-1.5 text-sm text-ink-dim">
                    Hour-bucketed message/emoji/voice/game <strong className="text-ink">counts</strong> per user + channel.
                    Message <strong className="text-ink">content is never stored</strong> — only that a message happened, its
                    length, and its emoji/mention/reply counts.
                  </p>
                </div>
                <div className="rounded-xl border border-line bg-bg-card2 p-3">
                  <div className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Voice sessions</div>
                  <p className="mt-1.5 text-sm text-ink-dim">
                    One row per voice join→leave (channel + duration) so recent-session lists work, plus the same
                    hour-bucketed seconds used everywhere else.
                  </p>
                </div>
                <div className="rounded-xl border border-line bg-bg-card2 p-3">
                  <div className="text-xs font-semibold uppercase tracking-wider text-ink-faint">History backfill</div>
                  <p className="mt-1.5 text-sm text-ink-dim">
                    Optional, separate toggle after enabling. Rate-limited scan of existing channel history
                    <em> older</em> than the moment you enable — never overlaps with live tracking.
                  </p>
                </div>
              </div>
              <div className="flex items-center justify-between gap-4 rounded-xl border border-accent/30 bg-accent-soft/40 p-4">
                <p className="text-sm text-ink-dim">
                  Everyone with panel access gets their own activity page once this is on — sudo gets the full
                  dashboard below.
                </p>
                <EnableStatsButton />
              </div>
            </CardBody>
          </Card>
        </div>
      </div>
    )
  }

  const [totals, heatmap, channels, users, games, topEmojis, memberTrend, backfill] = await Promise.all([
    getServerTotals(range),
    getServerHeatmap(metric, range, tz),
    getChannelLeaderboard(range, 8),
    getUserLeaderboard(range, 8),
    getTopGames(range, 8),
    getTopEmojis('message', range, 8),
    getMemberTrend(range),
    getBackfillSummary(),
  ])

  const displayMap = await resolveDisplayNames(users.map((u) => u.userId))

  const maxHeatmapValue = heatmap.reduce((m, c) => Math.max(m, c.value), 0)
  const backfillTotal = backfill.channels.total
  const backfillDonePct = backfillTotal > 0 ? Math.round(((backfill.channels.done + backfill.channels.skipped) / backfillTotal) * 100) : 0

  return (
    <div className="p-6 sm:p-10 pt-16 md:pt-10">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <PageHeader
          icon="stats"
          eyebrow="Squishy"
          title="Activity Stats"
          description="Server-wide engagement — messages, voice, games, reactions. Counts only, never message content."
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <ChipGroup>
                {STATS_RANGES.map((r) => (
                  <Chip key={r} href={`/squishy/stats${qs(base, { range: r })}`} active={r === range}>
                    {STATS_RANGE_LABELS[r]}
                  </Chip>
                ))}
              </ChipGroup>
              <ChipGroup>
                {STATS_TZ_ALLOWLIST.map((t) => (
                  <Chip key={t} href={`/squishy/stats${qs(base, { tz: t })}`} active={t === tz}>
                    {STATS_TZ_LABELS[t]}
                  </Chip>
                ))}
              </ChipGroup>
            </div>
          }
        />

        <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <StatCard label="Messages" value={totals.messages.toLocaleString()} hint={STATS_RANGE_LABELS[range]} icon="activity" tone="accent" />
          <StatCard label="Active users" value={totals.activeUsers.toLocaleString()} hint="messaged or voice-chatted" icon="users" tone="info" />
          <StatCard label="Voice" value={formatHours(totals.voiceSeconds)} hint="total time in channels" icon="voice" tone="success" />
          <StatCard label="Reactions" value={totals.reactions.toLocaleString()} hint="given by members" icon="sparkles" tone="warning" />
          <StatCard
            label="Top game"
            value={totals.topGame ? totals.topGame.gameName : '—'}
            hint={totals.topGame ? `${formatHours(totals.topGame.seconds)} played` : 'no presence data yet'}
            icon="games"
            tone="neutral"
          />
        </section>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Activity heatmap</CardTitle>
              <CardDescription>
                {metric === 'voice' ? 'Voice minutes' : 'Messages'} by day of week &amp; hour, {STATS_TZ_LABELS[tz]} time.
              </CardDescription>
            </div>
            <ChipGroup>
              <Chip href={`/squishy/stats${qs(base, { metric: 'messages' })}`} active={metric === 'messages'}>
                Messages
              </Chip>
              <Chip href={`/squishy/stats${qs(base, { metric: 'voice' })}`} active={metric === 'voice'}>
                Voice
              </Chip>
            </ChipGroup>
          </CardHeader>
          <CardBody>
            {heatmap.length === 0 ? (
              <p className="text-sm text-ink-dim">No {metric === 'voice' ? 'voice' : 'message'} activity recorded for this range yet.</p>
            ) : (
              <Heatmap
                cells={heatmap}
                maxValue={maxHeatmapValue}
                color={metric === 'voice' ? 'aqua' : 'accent'}
                ariaLabel={`${metric === 'voice' ? 'Voice minutes' : 'Messages'} by day of week and hour`}
              />
            )}
          </CardBody>
        </Card>

        <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Top channels</CardTitle>
                <CardDescription>Blended message + voice activity</CardDescription>
              </div>
            </CardHeader>
            <CardBody>
              {channels.length === 0 ? (
                <p className="text-sm text-ink-dim">No channel activity yet.</p>
              ) : (
                <BarList
                  color="accent"
                  items={channels.map((c) => ({
                    label: c.channelName ?? <span className="font-mono text-xs">{c.channelId}</span>,
                    value: c.messages,
                    hint: c.voiceSeconds > 0 ? `+ ${formatHours(c.voiceSeconds)} voice` : undefined,
                    href: `/squishy/stats/channels/${c.channelId}`,
                  }))}
                />
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Top members</CardTitle>
                <CardDescription>By message count</CardDescription>
              </div>
              <Link href="/squishy/stats/users" className="text-xs text-accent hover:underline whitespace-nowrap">
                Full leaderboard →
              </Link>
            </CardHeader>
            <CardBody>
              {users.length === 0 ? (
                <p className="text-sm text-ink-dim">No member activity yet.</p>
              ) : (
                <BarList
                  color="accent"
                  items={users.map((u) => {
                    const info = displayMap.get(u.userId)
                    return {
                      label: info?.name ?? u.userId,
                      value: u.messages,
                      hint: u.voiceSeconds > 0 ? `+ ${formatHours(u.voiceSeconds)} voice` : undefined,
                      href: `/squishy/stats/users/${u.userId}`,
                    }
                  })}
                />
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Top games</CardTitle>
                <CardDescription>By Discord presence time</CardDescription>
              </div>
            </CardHeader>
            <CardBody>
              {games.length === 0 ? (
                <p className="text-sm text-ink-dim">No presence data yet.</p>
              ) : (
                <BarList
                  color="aqua"
                  items={games.map((g) => ({ label: g.gameName, value: g.seconds }))}
                  formatValue={(v) => formatHours(v)}
                />
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Top emojis</CardTitle>
                <CardDescription>Used in messages</CardDescription>
              </div>
            </CardHeader>
            <CardBody>
              {topEmojis.length === 0 ? (
                <p className="text-sm text-ink-dim">No emoji usage recorded yet.</p>
              ) : (
                <BarList color="aqua" items={topEmojis.map((e) => ({ label: <EmojiLabel row={e} />, value: e.count }))} />
              )}
            </CardBody>
          </Card>
        </section>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Member count</CardTitle>
              <CardDescription>Guild size over time, from join/leave snapshots</CardDescription>
            </div>
          </CardHeader>
          <CardBody>
            {memberTrend.length < 2 ? (
              <p className="text-sm text-ink-dim">Not enough join/leave history yet to plot a trend.</p>
            ) : (
              <TrendLine points={memberTrend} color="ok" ariaLabel="Guild member count over time" height={72} />
            )}
          </CardBody>
        </Card>

        <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>History backfill</CardTitle>
                <CardDescription>
                  Rate-limited scan of channel history older than tracking start
                </CardDescription>
              </div>
              <Badge tone={state.backfillEnabled ? 'success' : 'neutral'} dot pulse={state.backfillEnabled}>
                {state.backfillEnabled ? 'Running' : 'Paused'}
              </Badge>
            </CardHeader>
            <CardBody className="flex flex-col gap-4">
              {backfillTotal === 0 ? (
                <p className="text-sm text-ink-dim">No channels queued yet — progress rows are created once backfill first runs.</p>
              ) : (
                <>
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between text-xs text-ink-dim">
                      <span>{backfill.channels.done + backfill.channels.skipped} / {backfillTotal} channels finished</span>
                      <span>{backfill.messagesScanned.toLocaleString()} messages scanned</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-bg-raised">
                      <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${backfillDonePct}%` }} />
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge tone={BACKFILL_STATUS_TONE.done}>{backfill.channels.done} done</Badge>
                    <Badge tone={BACKFILL_STATUS_TONE.running}>{backfill.channels.running} running</Badge>
                    <Badge tone={BACKFILL_STATUS_TONE.pending}>{backfill.channels.pending} pending</Badge>
                    <Badge tone={BACKFILL_STATUS_TONE.error}>{backfill.channels.error} error</Badge>
                    <Badge tone={BACKFILL_STATUS_TONE.skipped}>{backfill.channels.skipped} skipped</Badge>
                  </div>
                  {backfill.currentChannelId && (
                    <p className="text-xs text-ink-dim">
                      Currently scanning <span className="font-mono">{backfill.currentChannelId}</span>
                    </p>
                  )}
                </>
              )}
              <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
                <BackfillToggleButton backfillEnabled={state.backfillEnabled} />
                <ResetBackfillButton />
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Tracking</CardTitle>
                <CardDescription>
                  {state.enabledAt ? <>Enabled {relTime(state.enabledAt)}</> : 'Enabled'}
                </CardDescription>
              </div>
              <Badge tone="success" dot pulse>
                Live
              </Badge>
            </CardHeader>
            <CardBody className="flex flex-col gap-4">
              <p className="text-sm text-ink-dim">
                Counts + voice sessions only — message content is never stored. Disabling stops new events from
                being recorded; nothing already collected is deleted.
              </p>
              <div className="border-t border-line pt-3">
                <DisableStatsButton />
              </div>
            </CardBody>
          </Card>
        </section>
      </div>
    </div>
  )
}

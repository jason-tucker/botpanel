/**
 * /squishy/stats/users/[userId] — per-member activity detail.
 *
 * Allowed: sudo, bot owner, or the viewer looking at their own id
 * (`access.viewing.id === userId`, so View-As "look at what this user
 * sees" also works). Everyone else gets a house-style 403 card.
 *
 * This is the page every non-sudo member actually lands on — `/squishy/
 * stats` and `/squishy/stats/me` both redirect here for non-sudo viewers.
 */
import Link from 'next/link'
import Image from 'next/image'
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { getSession } from '@/lib/auth/session'
import { resolveAccess } from '@/lib/auth/perms'
import { getViewAsUserId } from '@/lib/auth/viewAs'
import { resolveOneUsername } from '@/lib/userDisplay'
import { relTime } from '@/lib/util/format'
import {
  STATS_RANGES,
  STATS_RANGE_LABELS,
  tzChips,
  tzLabel,
  normalizeRange,
  normalizeTz,
  getStatsEnabledState,
  getUserStats,
  AUTO_GROUP_LABEL,
  type StatsRange,
  type StatsTz,
  type EmojiRow,
} from '@/lib/stats/squishy'
import { PageHeader, StatCard, Card, CardHeader, CardTitle, CardDescription, CardBody, EmptyState, Heatmap, BarList, Icon } from '@/components/ui'
import { MemberJump } from '@/components/MemberJump'

export const dynamic = 'force-dynamic'

const SNOWFLAKE_RE = /^\d{15,25}$/

function formatHours(seconds: number): string {
  return `${(seconds / 3600).toFixed(1)}h`
}

/** Elapsed-time formatter for a voice session row. Deliberately NOT
 *  `@/lib/util/format`'s `formatDuration` — that one's tuned for `/play`
 *  cooldown semantics (`0` → "disabled", `null` → "default"), which would
 *  mislabel a genuinely instant join/leave here. */
function formatSessionDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  const hr = Math.floor(seconds / 3600)
  const min = Math.round((seconds % 3600) / 60)
  return min === 0 ? `${hr}h` : `${hr}h ${min}m`
}

function qs(base: { range: string; tz: string }, override: Partial<typeof base>): string {
  const merged = { ...base, ...override }
  const sp = new URLSearchParams()
  sp.set('range', merged.range)
  sp.set('tz', merged.tz)
  return `?${sp.toString()}`
}

function EmojiLabel({ row }: { row: EmojiRow }) {
  // Custom keys must be snowflakes before they're allowed into a CDN URL —
  // anything else falls through to the text branch instead of a broken image.
  if (row.custom && /^\d+$/.test(row.emojiKey)) {
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

function NotFoundCard() {
  return (
    <main className="min-h-dvh p-6 sm:p-10">
      <div className="mx-auto flex max-w-md flex-col gap-3 rounded-2xl border border-line bg-bg-card p-6">
        <h1 className="text-xl font-semibold">404 — Not a Discord snowflake</h1>
        <p className="text-sm text-ink-dim">
          The id in the URL doesn&apos;t look like a Discord user id (15-25 digits).
        </p>
        <Link href="/squishy/stats" className="self-start text-sm text-accent underline">
          ← Back to Activity Stats
        </Link>
      </div>
    </main>
  )
}

function ForbiddenCard() {
  return (
    <main className="min-h-dvh p-6 sm:p-10">
      <div className="mx-auto flex max-w-md flex-col gap-3 rounded-2xl border border-line bg-bg-card p-6">
        <h1 className="text-xl font-semibold">403 — Not allowed</h1>
        <p className="text-sm text-ink-dim">
          You can only view your own activity page. Sudo and the bot owner can view anyone&apos;s.
        </p>
        <Link href="/squishy/stats" className="self-start text-sm text-accent underline">
          ← Back to Activity Stats
        </Link>
      </div>
    </main>
  )
}

export default async function SquishyStatsUserDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ userId: string }>
  searchParams: Promise<{ range?: string; tz?: string }>
}) {
  const session = await getSession()
  if (!session) redirect('/')

  const { userId } = await params
  if (!SNOWFLAKE_RE.test(userId)) return <NotFoundCard />

  const viewAsUserId = await getViewAsUserId()
  const access = await resolveAccess(session, viewAsUserId ? { viewAsUserId } : undefined)
  const isPriv = access.botOwner || access.squishy.sudo
  const allowed = isPriv || access.viewing.id === userId
  if (!allowed) return <ForbiddenCard />

  const sp = await searchParams
  const range: StatsRange = normalizeRange(sp.range)
  const tz: StatsTz = normalizeTz(sp.tz, (await cookies()).get('stats_tz')?.value)
  const base = { range, tz }

  const state = await getStatsEnabledState()
  if (!state.enabled) {
    return (
      <div className="p-6 sm:p-10 pt-16 md:pt-10">
        <div className="mx-auto flex max-w-3xl flex-col gap-6">
          <PageHeader icon="stats" eyebrow="Squishy" title="Activity" description="Activity Stats is currently disabled." />
          <Card>
            <CardBody>
              <EmptyState
                icon="stats"
                title="Activity Stats is off"
                description="An owner or sudo needs to enable tracking before any activity data exists."
                action={
                  access.botOwner || access.squishy.sudo ? (
                    <Link href="/squishy/stats" className="text-sm text-accent hover:underline">
                      Go to Activity Stats →
                    </Link>
                  ) : undefined
                }
              />
            </CardBody>
          </Card>
        </div>
      </div>
    )
  }

  const [stats, resolvedUser] = await Promise.all([
    getUserStats(userId, range, tz),
    resolveOneUsername('squishy', userId),
  ])

  const displayName = resolvedUser?.displayName || resolvedUser?.username || userId
  const maxTextHeatmap = stats.textHeatmap.reduce((m, c) => Math.max(m, c.value), 0)
  const maxVoiceHeatmap = stats.voiceHeatmap.reduce((m, c) => Math.max(m, c.value), 0)

  return (
    <div className="p-6 sm:p-10 pt-16 md:pt-10">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <PageHeader
          icon="stats"
          eyebrow="Squishy · Activity"
          title={displayName}
          description={
            stats.firstSeen
              ? <>First seen {relTime(stats.firstSeen)} · last active {stats.lastSeen ? relTime(stats.lastSeen) : '—'}</>
              : 'No recorded activity yet for this range.'
          }
          actions={
            <div className="flex flex-wrap items-center gap-2">
              {isPriv && <MemberJump hrefTemplate="/squishy/stats/users/{id}" placeholder="Switch member…" />}
              <div className="inline-flex items-center gap-1 rounded-lg border border-line bg-bg-card2 p-1">
                {STATS_RANGES.map((r) => (
                  <Link
                    key={r}
                    href={`/squishy/stats/users/${userId}${qs(base, { range: r })}`}
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
                    href={`/squishy/stats/users/${userId}${qs(base, { tz: t })}`}
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

        {(access.botOwner || access.squishy.sudo) && (
          <div>
            <Link href="/squishy/stats" className="text-sm text-ink-dim hover:text-ink">
              ← Activity Stats
            </Link>
          </div>
        )}

        <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <StatCard label="Messages" value={stats.totals.messages.toLocaleString()} icon="activity" tone="accent" />
          <StatCard label="Words" value={stats.totals.wordCount.toLocaleString()} icon="edit" tone="neutral" />
          <StatCard label="Voice" value={formatHours(stats.totals.voiceSeconds)} icon="voice" tone="success" />
          <StatCard label="Reactions given" value={stats.totals.reactionsGiven.toLocaleString()} icon="sparkles" tone="warning" />
          <StatCard label="Reactions received" value={stats.totals.reactionsReceived.toLocaleString()} icon="sparkles" tone="info" />
        </section>

        <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Text activity</CardTitle>
                <CardDescription>Messages by day of week &amp; hour, {tzLabel(tz)}</CardDescription>
              </div>
            </CardHeader>
            <CardBody>
              {stats.textHeatmap.length === 0 ? (
                <p className="text-sm text-ink-dim">No messages recorded for this range.</p>
              ) : (
                <Heatmap cells={stats.textHeatmap} maxValue={maxTextHeatmap} color="accent" ariaLabel="Messages by day of week and hour" />
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Voice activity</CardTitle>
                <CardDescription>Minutes by day of week &amp; hour, {tzLabel(tz)}</CardDescription>
              </div>
            </CardHeader>
            <CardBody>
              {stats.voiceHeatmap.length === 0 ? (
                <p className="text-sm text-ink-dim">No voice time recorded for this range.</p>
              ) : (
                <Heatmap cells={stats.voiceHeatmap} maxValue={maxVoiceHeatmap} color="aqua" ariaLabel="Voice minutes by day of week and hour" />
              )}
            </CardBody>
          </Card>
        </section>

        <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Top channels</CardTitle>
                <CardDescription>Blended activity — messages + voice minutes</CardDescription>
              </div>
            </CardHeader>
            <CardBody>
              {stats.topChannels.length === 0 ? (
                <p className="text-sm text-ink-dim">No channel activity yet.</p>
              ) : (
                <BarList
                  color="accent"
                  items={stats.topChannels.map((c) => ({
                    // Ephemeral auto rooms fold into one group row (their
                    // individual channels are deleted on empty and would
                    // render as dead IDs here).
                    label: c.isAutoGroup ? (
                      <span className="inline-flex min-w-0 items-center gap-1.5 text-accent">
                        <Icon name="voice" size={14} />
                        <span className="truncate font-medium">{AUTO_GROUP_LABEL}</span>
                      </span>
                    ) : (
                      c.channelName ?? <span className="font-mono text-xs">{c.channelId}</span>
                    ),
                    value: Math.round(c.messages + c.voiceSeconds / 60),
                    hint: `${c.isAutoGroup && c.roomCount ? `${c.roomCount} room${c.roomCount === 1 ? '' : 's'} · ` : ''}${c.messages.toLocaleString('en-US')} msgs${c.voiceSeconds > 0 ? ` · ${formatHours(c.voiceSeconds)} voice` : ''}`,
                    // Channel drill-down is sudo-only — a member's own page
                    // must not be full of links that 403 them.
                    href: isPriv ? (c.isAutoGroup ? '/squishy/stats/auto-voice' : `/squishy/stats/channels/${c.channelId}`) : undefined,
                  }))}
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
              {stats.topGames.length === 0 ? (
                <p className="text-sm text-ink-dim">No presence data yet.</p>
              ) : (
                <BarList color="aqua" items={stats.topGames.map((g) => ({ label: g.gameName, value: g.seconds }))} formatValue={(v) => formatHours(v)} />
              )}
            </CardBody>
          </Card>
        </section>

        <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Emojis given</CardTitle>
                <CardDescription>Reactions this member added</CardDescription>
              </div>
            </CardHeader>
            <CardBody>
              {stats.topEmojisGiven.length === 0 ? (
                <p className="text-sm text-ink-dim">No reactions given yet.</p>
              ) : (
                <BarList color="accent" items={stats.topEmojisGiven.map((e) => ({ label: <EmojiLabel row={e} />, value: e.count }))} />
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Emojis received</CardTitle>
                <CardDescription>Reactions landed on this member&apos;s messages</CardDescription>
              </div>
            </CardHeader>
            <CardBody>
              {stats.topEmojisReceived.length === 0 ? (
                <p className="text-sm text-ink-dim">No reactions received yet.</p>
              ) : (
                <BarList color="aqua" items={stats.topEmojisReceived.map((e) => ({ label: <EmojiLabel row={e} />, value: e.count }))} />
              )}
            </CardBody>
          </Card>
        </section>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Recent voice sessions</CardTitle>
              <CardDescription>Last {stats.recentVoiceSessions.length || 0} joins, most recent first</CardDescription>
            </div>
          </CardHeader>
          <CardBody className="!p-0">
            {stats.recentVoiceSessions.length === 0 ? (
              <p className="p-5 text-sm text-ink-dim">No voice sessions recorded yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-bg-card2 text-xs uppercase tracking-wider text-ink-dim">
                    <tr>
                      <th className="px-5 py-2 font-medium">Channel</th>
                      <th className="px-5 py-2 font-medium">Joined</th>
                      <th className="px-5 py-2 font-medium">Left</th>
                      <th className="px-5 py-2 font-medium text-right">Duration</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.recentVoiceSessions.map((s) => (
                      <tr key={s.id} className="border-b border-line last:border-b-0">
                        <td className="px-5 py-2 text-sm">
                          {s.channelName ?? <span className="font-mono text-xs text-ink-dim">{s.channelId}</span>}
                        </td>
                        <td className="px-5 py-2 text-xs text-ink-dim whitespace-nowrap" title={s.joinedAt.toISOString()}>
                          {relTime(s.joinedAt)}
                        </td>
                        <td className="px-5 py-2 text-xs text-ink-dim whitespace-nowrap">
                          {s.leftAt ? relTime(s.leftAt) : <span className="text-ok">still in channel</span>}
                        </td>
                        <td className="px-5 py-2 text-right text-sm tabular-nums">
                          {s.durationSeconds != null ? formatSessionDuration(s.durationSeconds) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  )
}

/**
 * /squishy/automation — read-only Squishy automation overview.
 *
 * Server component. Sudo-gated (Squishy sudo OR bot owner). Two tabs in one
 * page — `Auto Threads` and `Social Feeds` — selected via the `?tab=` query
 * string so we never ship a client component just for the bar. Both
 * datasets are fetched in parallel via `Promise.allSettled`, so a single
 * DB hiccup degrades only its tab (rendering an inline "data unavailable"
 * card) while the other tab still works.
 *
 * Notes on the live schemas vs the original task spec:
 *  - `auto_thread_channels` doesn't have `media_only` / `link_only` /
 *    `label` columns — the actual schema (post sync) tracks `name_template`,
 *    `archive_duration`, `added_by_discord_id`, and `added_at`. The "mode
 *    pill" column degrades to a gray `all` pill for every row since every
 *    configured channel auto-threads every non-bot, non-system message.
 *  - `social_feeds` doesn't carry an `error_count` or `source = 'rss'`
 *    discriminator — `source` is implicitly RSS via `source_url`, and only
 *    the last error is retained (`last_error` text + `last_polled_at`).
 *    We render an `rss` pill unconditionally and a red `error` badge when
 *    `last_error` is set, with the error message as the tooltip.
 */
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { asc, desc } from 'drizzle-orm'
import { ExternalLink } from 'lucide-react'
import { getSession } from '@/lib/auth/session'
import { resolveAccess } from '@/lib/auth/perms'
import { env } from '@/lib/env'
import { squishyDb } from '@/lib/db/squishy'
import { autoThreadChannels, socialFeeds } from '@/lib/db/schema/squishy'
import { discordChannelUrl, relTime } from '@/lib/util/format'

export const dynamic = 'force-dynamic'

type ThreadRow = {
  channelId: string
  guildId: string
  nameTemplate: string | null
  archiveDuration: number | null
  addedByDiscordId: string | null
  addedAt: Date
}

type FeedRow = {
  id: string
  guildId: string
  label: string
  sourceUrl: string
  channelId: string
  enabled: boolean
  lastSeenId: string | null
  lastPolledAt: Date | null
  lastError: string | null
  maxItemsPerPoll: number
  createdByDiscordId: string | null
  createdAt: Date
}

type TabKey = 'threads' | 'feeds'

function pickTab(raw: string | string[] | undefined): TabKey {
  const v = Array.isArray(raw) ? raw[0] : raw
  return v === 'feeds' ? 'feeds' : 'threads'
}

async function loadThreads(): Promise<ThreadRow[]> {
  return squishyDb
    .select({
      channelId: autoThreadChannels.channelId,
      guildId: autoThreadChannels.guildId,
      nameTemplate: autoThreadChannels.nameTemplate,
      archiveDuration: autoThreadChannels.archiveDuration,
      addedByDiscordId: autoThreadChannels.addedByDiscordId,
      addedAt: autoThreadChannels.addedAt,
    })
    .from(autoThreadChannels)
    .orderBy(desc(autoThreadChannels.addedAt))
}

async function loadFeeds(): Promise<FeedRow[]> {
  return squishyDb
    .select({
      id: socialFeeds.id,
      guildId: socialFeeds.guildId,
      label: socialFeeds.label,
      sourceUrl: socialFeeds.sourceUrl,
      channelId: socialFeeds.channelId,
      enabled: socialFeeds.enabled,
      lastSeenId: socialFeeds.lastSeenId,
      lastPolledAt: socialFeeds.lastPolledAt,
      lastError: socialFeeds.lastError,
      maxItemsPerPoll: socialFeeds.maxItemsPerPoll,
      createdByDiscordId: socialFeeds.createdByDiscordId,
      createdAt: socialFeeds.createdAt,
    })
    .from(socialFeeds)
    .orderBy(asc(socialFeeds.label))
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max - 1) + '…'
}

function DbUnavailable() {
  return (
    <div className="rounded-xl border border-line bg-bg-card p-6 text-sm text-err">
      Data unavailable — the SquishyBot database isn&apos;t reachable from the
      panel right now. Check{' '}
      <code className="font-mono text-xs">SQUISHY_DATABASE_URL</code> and
      container networking, then refresh.
    </div>
  )
}

function TabLink({
  current,
  target,
  label,
  count,
}: {
  current: TabKey
  target: TabKey
  label: string
  count: number | null
}) {
  const active = current === target
  return (
    <Link
      href={`/squishy/automation?tab=${target}`}
      className={[
        'px-4 py-2 text-sm border-b-2 -mb-px transition-colors whitespace-nowrap',
        active
          ? 'bg-bg-card2 text-ink border-b-accent'
          : 'text-ink-dim border-b-transparent hover:bg-bg-card2/50',
      ].join(' ')}
    >
      {label}
      {count !== null && (
        <span className="ml-2 text-xs text-ink-dim tabular-nums">{count}</span>
      )}
    </Link>
  )
}

export default async function SquishyAutomationPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>
}) {
  const session = await getSession()
  if (!session) redirect('/api/auth/login')

  const access = await resolveAccess(session)
  const allowed = access.botOwner || access.squishy.sudo

  if (!allowed) {
    return (
      <main className="min-h-dvh p-6 sm:p-10">
        <div className="max-w-md mx-auto rounded-2xl border border-line bg-bg-card p-6 flex flex-col gap-3">
          <h1 className="text-xl font-semibold">403 — Not allowed</h1>
          <p className="text-ink-dim text-sm">
            Automation overview is sudo-only. Ask the bot owner to add your
            Discord ID to{' '}
            <code className="font-mono text-xs">SUDO_USER_IDS</code> or the{' '}
            <code className="font-mono text-xs">sudo_users</code> table.
          </p>
          <Link href="/me" className="text-sm text-accent underline self-start">
            ← Back to dashboard
          </Link>
        </div>
      </main>
    )
  }

  const sp = await searchParams
  const tab = pickTab(sp.tab)

  // Parallel + isolated: a single DB hiccup degrades only its tab.
  const [threadsRes, feedsRes] = await Promise.allSettled([
    loadThreads(),
    loadFeeds(),
  ])

  const threads =
    threadsRes.status === 'fulfilled' ? threadsRes.value : null
  const feeds = feedsRes.status === 'fulfilled' ? feedsRes.value : null
  if (threadsRes.status === 'rejected') {
    console.warn('[squishy/automation] threads load failed', threadsRes.reason)
  }
  if (feedsRes.status === 'rejected') {
    console.warn('[squishy/automation] feeds load failed', feedsRes.reason)
  }

  const guildId = env.GUILD_ID ?? null

  return (
    <main className="min-h-dvh p-6 sm:p-10">
      <div className="max-w-6xl mx-auto flex flex-col gap-6">
        <header className="flex items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold">Automation</h1>
            <p className="text-sm text-ink-dim">
              Read-only view of every auto-thread channel and social feed
              configured for SquishyBot.
            </p>
          </div>
          <Link
            href="/me"
            className="text-sm text-ink-dim hover:text-ink whitespace-nowrap"
          >
            ← Dashboard
          </Link>
        </header>

        <div className="border-b border-line flex items-center gap-1">
          <TabLink
            current={tab}
            target="threads"
            label="Auto Threads"
            count={threads ? threads.length : null}
          />
          <TabLink
            current={tab}
            target="feeds"
            label="Social Feeds"
            count={feeds ? feeds.length : null}
          />
        </div>

        {tab === 'threads' ? (
          <ThreadsPanel rows={threads} guildId={guildId} />
        ) : (
          <FeedsPanel rows={feeds} guildId={guildId} />
        )}

        {!guildId && (
          <div className="text-xs text-ink-dim">
            <code className="font-mono">GUILD_ID</code> isn&apos;t set in the
            panel env — Discord deep-links are hidden. Set it in{' '}
            <code className="font-mono">.env</code> to enable per-row links.
          </div>
        )}
      </div>
    </main>
  )
}

function ModePill() {
  // Every configured channel auto-threads every non-bot, non-system message
  // in the live schema — there's no media-only / link-only discriminator.
  // The pill is here for visual consistency with the spec and for forward
  // compatibility if filtering columns ever land.
  return (
    <span className="text-[10px] uppercase tracking-wider rounded px-1.5 py-0.5 bg-ink-dim/10 text-ink-dim border border-line">
      all
    </span>
  )
}

function ThreadsPanel({
  rows,
  guildId,
}: {
  rows: ThreadRow[] | null
  guildId: string | null
}) {
  if (rows === null) return <DbUnavailable />
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-line bg-bg-card p-6 text-sm text-ink-dim">
        No auto-thread channels configured. Add via{' '}
        <code className="font-mono text-xs">
          /sudo → Settings → Auto Threads
        </code>
        .
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-line bg-bg-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead className="bg-bg-card2 text-xs uppercase tracking-wider text-ink-dim">
            <tr>
              <th className="px-3 py-2 font-medium">Channel</th>
              <th className="px-3 py-2 font-medium">Mode</th>
              <th className="px-3 py-2 font-medium">Thread name template</th>
              <th className="px-3 py-2 font-medium">Archive</th>
              <th className="px-3 py-2 font-medium">Added by</th>
              <th className="px-3 py-2 font-medium">Added</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const url = discordChannelUrl(guildId ?? r.guildId, r.channelId)
              return (
                <tr
                  key={r.channelId}
                  className="border-b border-line last:border-b-0"
                >
                  <td className="px-3 py-2 whitespace-nowrap">
                    {url ? (
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-xs text-accent hover:underline"
                        title="Open in Discord"
                      >
                        {r.channelId}
                      </a>
                    ) : (
                      <span className="font-mono text-xs">{r.channelId}</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <ModePill />
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {r.nameTemplate ? (
                      <span className="font-mono">{r.nameTemplate}</span>
                    ) : (
                      <span className="text-ink-dim">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-ink-dim whitespace-nowrap">
                    {r.archiveDuration
                      ? `${r.archiveDuration} min`
                      : <span className="text-ink-dim">default</span>}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {r.addedByDiscordId ? (
                      <span className="font-mono text-xs">
                        &lt;@{r.addedByDiscordId}&gt;
                      </span>
                    ) : (
                      <span className="text-ink-dim">—</span>
                    )}
                  </td>
                  <td
                    className="px-3 py-2 text-xs text-ink-dim whitespace-nowrap"
                    title={r.addedAt.toISOString()}
                  >
                    {relTime(r.addedAt)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function FeedsPanel({
  rows,
  guildId,
}: {
  rows: FeedRow[] | null
  guildId: string | null
}) {
  if (rows === null) return <DbUnavailable />
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-line bg-bg-card p-6 text-sm text-ink-dim">
        No social feeds configured.
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-line bg-bg-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead className="bg-bg-card2 text-xs uppercase tracking-wider text-ink-dim">
            <tr>
              <th className="px-3 py-2 font-medium">Label</th>
              <th className="px-3 py-2 font-medium">Feed URL</th>
              <th className="px-3 py-2 font-medium">Source</th>
              <th className="px-3 py-2 font-medium">Target channel</th>
              <th className="px-3 py-2 font-medium">Last polled</th>
              <th className="px-3 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const channelUrl = discordChannelUrl(
                guildId ?? r.guildId,
                r.channelId,
              )
              const hasError = Boolean(r.lastError)
              return (
                <tr
                  key={r.id}
                  className="border-b border-line last:border-b-0"
                >
                  <td className="px-3 py-2 text-sm whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{r.label}</span>
                      {!r.enabled && (
                        <span className="text-[10px] uppercase tracking-wider text-ink-dim border border-line rounded px-1.5 py-0.5">
                          disabled
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    <a
                      href={r.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-accent hover:underline font-mono"
                      title={r.sourceUrl}
                    >
                      <span>{truncate(r.sourceUrl, 60)}</span>
                      <ExternalLink
                        className="w-3 h-3 shrink-0"
                        aria-hidden
                      />
                    </a>
                  </td>
                  <td className="px-3 py-2">
                    <span className="text-[10px] uppercase tracking-wider rounded px-1.5 py-0.5 bg-accent/10 text-accent border border-accent/30">
                      rss
                    </span>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {channelUrl ? (
                      <a
                        href={channelUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-xs text-accent hover:underline"
                        title="Open in Discord"
                      >
                        {r.channelId}
                      </a>
                    ) : (
                      <span className="font-mono text-xs">{r.channelId}</span>
                    )}
                  </td>
                  <td
                    className="px-3 py-2 text-xs text-ink-dim whitespace-nowrap"
                    title={r.lastPolledAt?.toISOString() ?? 'never polled'}
                  >
                    {r.lastPolledAt ? (
                      relTime(r.lastPolledAt)
                    ) : (
                      <span className="italic">never</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs whitespace-nowrap">
                    {hasError ? (
                      <span
                        className="inline-flex items-center gap-1 text-err border border-err/40 bg-err/10 rounded px-1.5 py-0.5 font-medium"
                        title={r.lastError ?? undefined}
                      >
                        error
                      </span>
                    ) : (
                      <span className="text-ink-dim">ok</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

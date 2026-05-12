/**
 * /squishy/hubs — read-only Hub Channels overview.
 *
 * Server component. Sudo-gated (Squishy sudo OR bot owner). Lists every row
 * in `hub_channels` with the per-hub defaults and a count of live spawned
 * channels (auto_channels rows whose `source_hub_id` matches this hub's
 * Discord voice channel ID — there's no FK in the schema, the bot stores
 * the channel ID at spawn time). If `GUILD_ID` is configured we render an
 * "Open in Discord" deep-link next to each hub; otherwise we show plain
 * text so a missing-env panel never renders broken URLs.
 *
 * The Active VCs page at `/squishy/voice` already shows the *spawned* side
 * of this relationship live — this page is the *configuration* side, so
 * the row link from there back to `/squishy/voice` is intentional.
 */
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { asc, eq, sql } from 'drizzle-orm'
import { getSession } from '@/lib/auth/session'
import { resolveAccess } from '@/lib/auth/perms'
import { env } from '@/lib/env'
import { squishyDb } from '@/lib/db/squishy'
import { hubChannels, autoChannels } from '@/lib/db/schema/squishy'
import { discordChannelUrl, relTime } from '@/lib/util/format'

export const dynamic = 'force-dynamic'

type HubRow = {
  id: string
  guildId: string
  channelId: string
  categoryId: string
  position: number
  label: string
  defaultTemplateKey: string | null
  defaultManualName: string | null
  defaultUserLimit: number | null
  lockdownUntil: Date | null
  createdAt: Date
  liveCount: number
}

/**
 * Pull all hubs + the count of currently-live auto-channels parented to each
 * one. We do this as a left-join + group-by so the result is a single round
 * trip and hubs with zero live spawns still appear (with `liveCount = 0`).
 *
 * If the DB module isn't reachable we return `null` so the page can render
 * an explicit "DB unavailable" state instead of 500-ing.
 */
async function loadHubs(): Promise<HubRow[] | null> {
  try {
    const rows = await squishyDb
      .select({
        id: hubChannels.id,
        guildId: hubChannels.guildId,
        channelId: hubChannels.channelId,
        categoryId: hubChannels.categoryId,
        position: hubChannels.position,
        label: hubChannels.label,
        defaultTemplateKey: hubChannels.defaultTemplateKey,
        defaultManualName: hubChannels.defaultManualName,
        defaultUserLimit: hubChannels.defaultUserLimit,
        lockdownUntil: hubChannels.lockdownUntil,
        createdAt: hubChannels.createdAt,
        liveCount: sql<number>`count(${autoChannels.id})::int`,
      })
      .from(hubChannels)
      .leftJoin(autoChannels, eq(autoChannels.sourceHubId, hubChannels.channelId))
      .groupBy(hubChannels.id)
      .orderBy(asc(hubChannels.position), asc(hubChannels.createdAt))
    return rows
  } catch (err) {
    console.warn('[squishy/hubs] hub_channels load failed', err)
    return null
  }
}

export default async function SquishyHubsPage() {
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
            Hub Channels overview is sudo-only. Ask the bot owner to add your
            Discord ID to <code className="font-mono text-xs">SUDO_USER_IDS</code>{' '}
            or the <code className="font-mono text-xs">sudo_users</code> table.
          </p>
          <Link href="/me" className="text-sm text-accent underline self-start">
            ← Back to dashboard
          </Link>
        </div>
      </main>
    )
  }

  const hubs = await loadHubs()
  const guildId = env.GUILD_ID ?? null

  return (
    <main className="min-h-dvh p-6 sm:p-10">
      <div className="max-w-6xl mx-auto flex flex-col gap-6">
        <header className="flex items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold">Hub Channels</h1>
            <p className="text-sm text-ink-dim">
              Read-only view of every configured hub. Live spawned channels
              live on{' '}
              <Link href="/squishy/voice" className="text-accent underline">
                Active VCs
              </Link>
              .
            </p>
          </div>
          <Link href="/me" className="text-sm text-ink-dim hover:text-ink whitespace-nowrap">
            ← Dashboard
          </Link>
        </header>

        {hubs === null ? (
          <div className="rounded-xl border border-line bg-bg-card p-6 text-sm text-err">
            Failed to load hub channels — the SquishyBot database isn&apos;t
            reachable from the panel right now. Check{' '}
            <code className="font-mono text-xs">SQUISHY_DATABASE_URL</code> and
            container networking, then refresh.
          </div>
        ) : hubs.length === 0 ? (
          <div className="rounded-xl border border-line bg-bg-card p-6 text-sm text-ink-dim">
            No hub channels configured. Add via{' '}
            <code className="font-mono text-xs">
              /sudo → Settings → Hub Channels
            </code>{' '}
            in Discord.
          </div>
        ) : (
          <div className="rounded-xl border border-line bg-bg-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-bg-card2 text-xs uppercase tracking-wider text-ink-dim">
                  <tr>
                    <th className="px-3 py-2 font-medium">Voice channel</th>
                    <th className="px-3 py-2 font-medium">Label</th>
                    <th className="px-3 py-2 font-medium text-right">Pos</th>
                    <th className="px-3 py-2 font-medium text-right">Live</th>
                    <th className="px-3 py-2 font-medium">Defaults</th>
                    <th className="px-3 py-2 font-medium">Lockdown</th>
                    <th className="px-3 py-2 font-medium">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {hubs.map((h) => {
                    const url = discordChannelUrl(guildId, h.channelId)
                    const lockdownActive =
                      h.lockdownUntil !== null &&
                      h.lockdownUntil.getTime() > Date.now()
                    return (
                      <tr key={h.id} className="border-b border-line last:border-b-0">
                        <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">
                          {url ? (
                            <a
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-accent hover:underline"
                              title="Open in Discord"
                            >
                              {h.channelId}
                            </a>
                          ) : (
                            <span className="text-ink-dim" title="GUILD_ID unset — link disabled">
                              {h.channelId}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-sm">{h.label}</td>
                        <td className="px-3 py-2 text-sm text-ink-dim text-right tabular-nums">
                          {h.position}
                        </td>
                        <td className="px-3 py-2 text-sm text-right tabular-nums">
                          {h.liveCount > 0 ? (
                            <Link
                              href="/squishy/voice"
                              className="text-accent hover:underline"
                              title="Open Active VCs"
                            >
                              {h.liveCount}
                            </Link>
                          ) : (
                            <span className="text-ink-dim">0</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs text-ink-dim">
                          {[
                            h.defaultTemplateKey ? `tpl: ${h.defaultTemplateKey}` : null,
                            h.defaultManualName ? `name: ${h.defaultManualName}` : null,
                            h.defaultUserLimit !== null && h.defaultUserLimit !== 0
                              ? `cap: ${h.defaultUserLimit}`
                              : null,
                          ]
                            .filter(Boolean)
                            .join(' · ') || <span className="italic">—</span>}
                        </td>
                        <td className="px-3 py-2 text-xs whitespace-nowrap">
                          {h.lockdownUntil === null ? (
                            <span className="text-ink-dim">—</span>
                          ) : lockdownActive ? (
                            <span
                              className="text-warn"
                              title={h.lockdownUntil.toISOString()}
                            >
                              until {relTime(h.lockdownUntil)}
                            </span>
                          ) : (
                            <span
                              className="text-ink-dim"
                              title={h.lockdownUntil.toISOString()}
                            >
                              ended {relTime(h.lockdownUntil)}
                            </span>
                          )}
                        </td>
                        <td
                          className="px-3 py-2 text-xs text-ink-dim whitespace-nowrap"
                          title={h.createdAt.toISOString()}
                        >
                          {relTime(h.createdAt)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {!guildId && hubs && hubs.length > 0 && (
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

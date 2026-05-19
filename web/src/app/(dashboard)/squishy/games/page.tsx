/**
 * /squishy/games — Games overview + sudo CRUD.
 *
 * Server component. Sudo-gated (Squishy sudo OR bot owner). Lists every row
 * in the `games` table with its per-game settings (view role, ping role,
 * channel, `/play` cooldown, auto-archive) plus opt-in counts pulled from
 * `user_game_prefs`. We compute the View / Ping counts in a single grouped
 * query and zip them into the games list in TS so the row's a single
 * Drizzle call. If the DB is unreachable we render an explicit error state.
 *
 * Wave 7b: the page is now editable. Top-of-page "Add game" form POSTs to
 * /api/squishy/games; each row has a collapsible inline Edit form that
 * PATCHes /api/squishy/games/[id]; each row has a flip-to-confirm Remove
 * that DELETEs the row and cascade-clears its user_game_prefs in the same
 * SQL transaction. Every successful write fires a fire-and-forget
 * `games.refresh_cache` RPC at the bot so its in-memory `catalog` reloads
 * — but a bot-side failure does NOT fail the panel-side write. The bot
 * reads the games table live for /play / /games regardless. See
 * `./GamesWriteUI.tsx` for the client islands.
 *
 * The schema names the visibility role `role_id` (kept loosely as the bot
 * evolved); the spec refers to it as "view role" — same column.
 */
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { asc, eq, sql } from 'drizzle-orm'
import { getSession } from '@/lib/auth/session'
import { resolveAccess } from '@/lib/auth/perms'
import { env } from '@/lib/env'
import { squishyDb } from '@/lib/db/squishy'
import { botSettings, games, userGamePrefs } from '@/lib/db/schema/squishy'
import { discordChannelUrl, formatDuration, relTime } from '@/lib/util/format'
import { AddGameForm, EditGameForm, PostLfgButton, RemoveGameButton } from './GamesWriteUI'

export const dynamic = 'force-dynamic'

type GameRow = {
  id: string
  name: string
  roleId: string | null
  pingRoleId: string | null
  channelId: string | null
  isArchived: boolean
  isVisible: boolean
  aliases: string[]
  playCooldownSeconds: number | null
  autoArchiveDays: number | null
  createdAt: Date
  viewCount: number
  pingCount: number
}

async function loadGames(): Promise<GameRow[] | null> {
  try {
    const gameRows = await squishyDb
      .select({
        id: games.id,
        name: games.name,
        roleId: games.roleId,
        pingRoleId: games.pingRoleId,
        channelId: games.channelId,
        isArchived: games.isArchived,
        isVisible: games.isVisible,
        aliases: games.aliases,
        playCooldownSeconds: games.playCooldownSeconds,
        autoArchiveDays: games.autoArchiveDays,
        createdAt: games.createdAt,
      })
      .from(games)
      .orderBy(asc(games.name))

    if (gameRows.length === 0) return []

    // One round trip for both opt-in flavors, grouped by game.
    const prefRows = await squishyDb
      .select({
        gameId: userGamePrefs.gameId,
        viewCount: sql<number>`sum(case when ${userGamePrefs.wantsView} then 1 else 0 end)::int`,
        pingCount: sql<number>`sum(case when ${userGamePrefs.wantsPing} then 1 else 0 end)::int`,
      })
      .from(userGamePrefs)
      .groupBy(userGamePrefs.gameId)

    const byId = new Map<string, { viewCount: number; pingCount: number }>()
    for (const r of prefRows) {
      byId.set(r.gameId, {
        viewCount: r.viewCount ?? 0,
        pingCount: r.pingCount ?? 0,
      })
    }

    return gameRows.map((g) => ({
      ...g,
      viewCount: byId.get(g.id)?.viewCount ?? 0,
      pingCount: byId.get(g.id)?.pingCount ?? 0,
    }))
  } catch (err) {
    console.warn('[squishy/games] games load failed', err)
    return null
  }
}

function Mono({ value }: { value: string | null }) {
  if (!value) return <span className="text-ink-dim">—</span>
  return <span className="font-mono text-xs">{value}</span>
}

/**
 * Read the games-category id from `bot_settings.channel.games_category`.
 * Drives the "+ Create" inline buttons on the edit form (so a freshly-
 * created channel lands in the same parent the bot's auto-provision flow
 * uses) and the Add-Game "Auto-provision" checkbox path. Returns null
 * when unset — the panel still works, the new channel just goes to the
 * top level until sudo wires `channel.games_category` via /sudo settings.
 */
async function loadGamesCategoryId(): Promise<string | null> {
  try {
    const rows = await squishyDb
      .select()
      .from(botSettings)
      .where(eq(botSettings.key, 'channel.games_category'))
    if (rows.length === 0) return null
    const v = rows[0].value?.trim()
    return v && v.length > 0 ? v : null
  } catch (err) {
    console.warn('[squishy/games] games-category lookup failed', err)
    return null
  }
}

export default async function SquishyGamesPage() {
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
            Games overview is sudo-only. Ask the bot owner to add your Discord
            ID to <code className="font-mono text-xs">SUDO_USER_IDS</code> or
            the <code className="font-mono text-xs">sudo_users</code> table.
          </p>
          <Link href="/me" className="text-sm text-accent underline self-start">
            ← Back to dashboard
          </Link>
        </div>
      </main>
    )
  }

  const [list, gamesCategoryId] = await Promise.all([
    loadGames(),
    loadGamesCategoryId(),
  ])
  const guildId = env.GUILD_ID ?? null

  return (
    <main className="min-h-dvh p-6 sm:p-10">
      <div className="max-w-6xl mx-auto flex flex-col gap-6">
        <header className="flex items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold">Games</h1>
            <p className="text-sm text-ink-dim">
              Manage every configured game. The bot reads this table live for
              /play and /games; the panel pings a cache-refresh hook after
              every write so the in-memory catalog stays current.
            </p>
          </div>
          <Link href="/me" className="text-sm text-ink-dim hover:text-ink whitespace-nowrap">
            ← Dashboard
          </Link>
        </header>

        <AddGameForm gamesCategoryId={gamesCategoryId} />

        {list === null ? (
          <div className="rounded-xl border border-line bg-bg-card p-6 text-sm text-err">
            Failed to load games — the SquishyBot database isn&apos;t reachable
            from the panel right now. Check{' '}
            <code className="font-mono text-xs">SQUISHY_DATABASE_URL</code> and
            container networking, then refresh.
          </div>
        ) : list.length === 0 ? (
          <div className="rounded-xl border border-line bg-bg-card p-6 text-sm text-ink-dim">
            No games configured. Add via{' '}
            <code className="font-mono text-xs">
              /sudo → Settings → Games
            </code>
            .
          </div>
        ) : (
          <div className="rounded-xl border border-line bg-bg-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-bg-card2 text-xs uppercase tracking-wider text-ink-dim">
                  <tr>
                    <th className="px-3 py-2 font-medium">Name</th>
                    <th className="px-3 py-2 font-medium">View role</th>
                    <th className="px-3 py-2 font-medium">Ping role</th>
                    <th className="px-3 py-2 font-medium">Channel</th>
                    <th className="px-3 py-2 font-medium text-right">View opt-ins</th>
                    <th className="px-3 py-2 font-medium text-right">Ping opt-ins</th>
                    <th className="px-3 py-2 font-medium">/play cooldown</th>
                    <th className="px-3 py-2 font-medium">Auto-archive</th>
                    <th className="px-3 py-2 font-medium">Created</th>
                    <th className="px-3 py-2 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((g) => {
                    const channelUrl = discordChannelUrl(guildId, g.channelId)
                    return (
                      <tr key={g.id} className="border-b border-line last:border-b-0 align-top">
                        <td className="px-3 py-2 text-sm whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{g.name}</span>
                            {g.isArchived && (
                              <span className="text-[10px] uppercase tracking-wider text-ink-dim border border-line rounded px-1.5 py-0.5">
                                archived
                              </span>
                            )}
                            {!g.isVisible && !g.isArchived && (
                              <span className="text-[10px] uppercase tracking-wider text-ink-dim border border-line rounded px-1.5 py-0.5">
                                hidden
                              </span>
                            )}
                          </div>
                          {g.aliases.length > 0 && (
                            <div className="text-[11px] text-ink-dim mt-0.5">
                              aka {g.aliases.join(', ')}
                            </div>
                          )}
                          {/* Inline edit form lives under the row's name cell so
                              its collapsed state is one button + 1 line of label.
                              Spans the full row when expanded via max-w. */}
                          <EditGameForm
                            id={g.id}
                            name={g.name}
                            channelId={g.channelId}
                            roleId={g.roleId}
                            pingRoleId={g.pingRoleId}
                            playCooldownSeconds={g.playCooldownSeconds}
                            autoArchiveDays={g.autoArchiveDays}
                            gamesCategoryId={gamesCategoryId}
                          />
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <Mono value={g.roleId} />
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <Mono value={g.pingRoleId} />
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {g.channelId ? (
                            channelUrl ? (
                              <a
                                href={channelUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-mono text-xs text-accent hover:underline"
                                title="Open in Discord"
                              >
                                {g.channelId}
                              </a>
                            ) : (
                              <span className="font-mono text-xs">{g.channelId}</span>
                            )
                          ) : (
                            <span className="text-ink-dim">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-sm text-right tabular-nums">
                          {g.viewCount}
                        </td>
                        <td className="px-3 py-2 text-sm text-right tabular-nums">
                          {g.pingCount}
                        </td>
                        <td className="px-3 py-2 text-sm whitespace-nowrap">
                          {formatDuration(g.playCooldownSeconds)}
                        </td>
                        <td className="px-3 py-2 text-sm whitespace-nowrap">
                          {g.autoArchiveDays && g.autoArchiveDays > 0
                            ? `${g.autoArchiveDays}d`
                            : <span className="text-ink-dim">off</span>}
                        </td>
                        <td
                          className="px-3 py-2 text-xs text-ink-dim whitespace-nowrap"
                          title={g.createdAt.toISOString()}
                        >
                          {relTime(g.createdAt)}
                        </td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          <div className="inline-flex items-start gap-2">
                            <PostLfgButton gameId={g.id} gameName={g.name} />
                            <RemoveGameButton id={g.id} name={g.name} />
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </main>
  )
}

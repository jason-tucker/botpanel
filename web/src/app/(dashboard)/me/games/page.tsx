/**
 * /me/games — per-user game prefs editor.
 *
 * Server component. Open to any logged-in user; everyone edits their own
 * prefs only (the route on the bot side keys writes to `access.actor.id`,
 * View-As is intentionally ignored to keep the audit row honest).
 *
 * Loads the catalog from `squishyDb.select().from(games)` plus the
 * viewer's existing `user_game_prefs` rows. The client island
 * (`./MyGamesEditor.tsx`) renders one row per game with two toggles
 * (View, Ping) and a single batched Save that POSTs to
 * `/api/squishy/me/games`. The bot-side `games.set_prefs` verb is what
 * actually grants the channel-view overwrite + ping role.
 */
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { and, asc, eq } from 'drizzle-orm'
import { getSession } from '@/lib/auth/session'
import { resolveAccess } from '@/lib/auth/perms'
import { squishyDb, squishySchema } from '@/lib/db/squishy'
import { env } from '@/lib/env'
import { MyGamesEditor } from './MyGamesEditor'

export const dynamic = 'force-dynamic'

export default async function MyGamesPage() {
  const session = await getSession()
  if (!session) redirect('/api/auth/login')

  const access = await resolveAccess(session)
  const viewerId = access.viewing.id

  // Catalog: show every visible+non-archived game, sorted by sortOrder then
  // name — matches `listGames()` on the bot side. Archived/hidden games are
  // intentionally excluded; if a user has prefs on a now-hidden game we let
  // those rows quietly hide (turning them off would be a behavior change).
  let catalog: Array<{
    id: string
    name: string
    aliases: string[]
    channelId: string | null
    pingRoleId: string | null
  }> = []
  let prefs: Array<{ gameId: string; wantsView: boolean; wantsPing: boolean }> = []
  let loadError: string | null = null

  try {
    const guildId = env.GUILD_ID

    // Parallelize the two reads — they're independent (catalog has no
    // per-user join, prefs is keyed on (guildId, userId)). Also push the
    // visible/non-archived filter into the SQL WHERE clause instead of
    // SELECT-everything-then-filter-in-JS: at the table's small size it
    // doesn't matter much today, but with no index the planner was
    // scanning every row including soft-archived games we'd then discard.
    const catalogPromise = squishyDb
      .select({
        id: squishySchema.games.id,
        name: squishySchema.games.name,
        aliases: squishySchema.games.aliases,
        channelId: squishySchema.games.channelId,
        pingRoleId: squishySchema.games.pingRoleId,
      })
      .from(squishySchema.games)
      .where(
        and(
          eq(squishySchema.games.isArchived, false),
          eq(squishySchema.games.isVisible, true),
        ),
      )
      .orderBy(asc(squishySchema.games.sortOrder), asc(squishySchema.games.name))

    const prefsPromise = guildId
      ? squishyDb
          .select({
            gameId: squishySchema.userGamePrefs.gameId,
            wantsView: squishySchema.userGamePrefs.wantsView,
            wantsPing: squishySchema.userGamePrefs.wantsPing,
          })
          .from(squishySchema.userGamePrefs)
          .where(
            and(
              eq(squishySchema.userGamePrefs.guildId, guildId),
              eq(squishySchema.userGamePrefs.userId, viewerId),
            ),
          )
      : Promise.resolve([] as typeof prefs)

    const [catalogRows, prefRows] = await Promise.all([catalogPromise, prefsPromise])
    catalog = catalogRows
    prefs = prefRows
  } catch (err) {
    console.warn('[me/games] load failed', err)
    loadError = (err as Error).message
  }

  const initial = new Map<string, { view: boolean; ping: boolean }>()
  for (const p of prefs) {
    initial.set(p.gameId, { view: p.wantsView, ping: p.wantsPing })
  }
  const rowsForUi = catalog.map((g) => ({
    gameId: g.id,
    name: g.name,
    aliases: g.aliases,
    view: initial.get(g.id)?.view ?? false,
    ping: initial.get(g.id)?.ping ?? false,
  }))

  return (
    <main className="min-h-dvh p-6 sm:p-10 pt-16 md:pt-10">
      <div className="max-w-3xl mx-auto flex flex-col gap-6">
        <header className="flex items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold">My Game Prefs</h1>
            <p className="text-sm text-ink-dim">
              Pick which games you want channel access and LFG pings for.
              Saving applies the changes on Discord immediately — same as
              running <code className="font-mono text-xs">/games</code> in the
              server.
            </p>
          </div>
          <Link href="/me" className="text-sm text-ink-dim hover:text-ink whitespace-nowrap">
            ← Dashboard
          </Link>
        </header>

        {loadError !== null ? (
          <div className="rounded-xl border border-line bg-bg-card p-6 text-sm text-err">
            Failed to load games — the SquishyBot database isn&apos;t reachable
            from the panel right now. Check{' '}
            <code className="font-mono text-xs">SQUISHY_DATABASE_URL</code> and
            container networking, then refresh.
          </div>
        ) : rowsForUi.length === 0 ? (
          <div className="rounded-xl border border-line bg-bg-card p-6 text-sm text-ink-dim">
            No games to opt into right now. A sudo will add games via{' '}
            <code className="font-mono text-xs">/sudo → Settings → Games</code>{' '}
            or the panel&apos;s{' '}
            <Link href="/squishy/games" className="text-accent hover:underline">Games</Link>{' '}
            page.
          </div>
        ) : (
          <MyGamesEditor rows={rowsForUi} />
        )}
      </div>
    </main>
  )
}

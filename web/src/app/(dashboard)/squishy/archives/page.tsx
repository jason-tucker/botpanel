/**
 * /squishy/archives — read-only Archived Channels overview.
 *
 * Server component. Sudo-gated (Squishy sudo OR bot owner). Lists every row
 * in `archived_channels` ordered by `archived_at desc`, capped at 100. URL-
 * driven substring search (`?q=…`) filters via `originalName ILIKE` so links
 * are shareable and there's no client state.
 *
 * The vendored schema (`schema/squishy/archive.ts`) carries these columns:
 *   channelId (PK)             — the channel's Discord ID (also the
 *                                "archived channel" ID — the bot renames the
 *                                channel in place rather than creating a new
 *                                one in an archive category, so there is no
 *                                separate `archivedChannelId` to show).
 *   guildId                    — owning guild.
 *   originalCategoryId         — the parent category at archive time, used
 *                                for restore.
 *   originalName               — the channel name at archive time.
 *   archivedAt                 — when the workflow ran.
 *   archivedByUserId           — Discord ID of the sudo user who archived.
 *
 * The wave5 spec also mentioned optional `gameId` + `reason` columns and a
 * separate `archivedChannelId`. None of those exist in the current vendored
 * schema, so we render what's actually there. If the schema gains those
 * columns later, extend the row type + table; nothing else needs to change.
 *
 * Edit / unarchive is owned by the bot via `/sudo → Archive`. This view is
 * intentionally read-only.
 */
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { desc, ilike } from 'drizzle-orm'
import { getSession } from '@/lib/auth/session'
import { resolveAccess } from '@/lib/auth/perms'
import { env } from '@/lib/env'
import { squishyDb } from '@/lib/db/squishy'
import { archivedChannels } from '@/lib/db/schema/squishy'
import { discordChannelUrl, relTime } from '@/lib/util/format'

export const dynamic = 'force-dynamic'

const ROW_CAP = 100

type ArchivedRow = {
  channelId: string
  guildId: string
  originalCategoryId: string | null
  originalName: string
  archivedAt: Date
  archivedByUserId: string | null
}

async function loadArchived(q: string | null): Promise<ArchivedRow[] | null> {
  try {
    const base = squishyDb
      .select({
        channelId: archivedChannels.channelId,
        guildId: archivedChannels.guildId,
        originalCategoryId: archivedChannels.originalCategoryId,
        originalName: archivedChannels.originalName,
        archivedAt: archivedChannels.archivedAt,
        archivedByUserId: archivedChannels.archivedByUserId,
      })
      .from(archivedChannels)

    const rows = q
      ? await base
          .where(ilike(archivedChannels.originalName, `%${q}%`))
          .orderBy(desc(archivedChannels.archivedAt))
          .limit(ROW_CAP)
      : await base.orderBy(desc(archivedChannels.archivedAt)).limit(ROW_CAP)

    return rows
  } catch (err) {
    console.warn('[squishy/archives] list load failed', err)
    return null
  }
}

export default async function SquishyArchivesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
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
            Archived channels view is sudo-only. Ask the bot owner to add your
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
  const q = (sp.q ?? '').trim() || null
  const list = await loadArchived(q)
  const guildId = env.GUILD_ID ?? null

  return (
    <main className="min-h-dvh p-6 sm:p-10">
      <div className="max-w-6xl mx-auto flex flex-col gap-6">
        <header className="flex items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold">Archived channels</h1>
            <p className="text-sm text-ink-dim">
              Read-only list of channels currently in the archived state.
              Restore via{' '}
              <code className="font-mono text-xs">/sudo → Archive</code> in
              Discord.
            </p>
          </div>
          <Link
            href="/me"
            className="text-sm text-ink-dim hover:text-ink whitespace-nowrap"
          >
            ← Dashboard
          </Link>
        </header>

        <form
          action="/squishy/archives"
          method="GET"
          className="flex items-center gap-2"
        >
          <input
            type="text"
            name="q"
            defaultValue={q ?? ''}
            placeholder="Search by original channel name…"
            className="flex-1 rounded-lg border border-line bg-bg-card2 px-3 py-2 text-sm text-ink placeholder:text-ink-dim/70 focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <button
            type="submit"
            className="rounded-lg border border-line bg-bg-card2 hover:bg-bg-card2/70 px-3 py-2 text-sm text-ink"
          >
            Search
          </button>
          {q && (
            <Link
              href="/squishy/archives"
              className="rounded-lg border border-line bg-transparent hover:bg-bg-card2/50 px-3 py-2 text-sm text-ink-dim hover:text-ink"
            >
              Clear
            </Link>
          )}
        </form>

        {list === null ? (
          <div className="rounded-xl border border-line bg-bg-card p-6 text-sm text-err">
            Failed to load archived channels — the SquishyBot database
            isn&apos;t reachable from the panel right now. Check{' '}
            <code className="font-mono text-xs">SQUISHY_DATABASE_URL</code> and
            container networking, then refresh.
          </div>
        ) : list.length === 0 ? (
          <div className="rounded-xl border border-line bg-bg-card p-6 text-sm text-ink-dim">
            {q ? (
              <>
                No archived channels match{' '}
                <span className="font-mono">&apos;{q}&apos;</span>.
              </>
            ) : (
              <>No channels are currently archived.</>
            )}
          </div>
        ) : (
          <div className="rounded-xl border border-line bg-bg-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-bg-card2 text-xs uppercase tracking-wider text-ink-dim">
                  <tr>
                    <th className="px-3 py-2 font-medium">Original name</th>
                    <th className="px-3 py-2 font-medium">Channel ID</th>
                    <th className="px-3 py-2 font-medium">Original category</th>
                    <th className="px-3 py-2 font-medium">Archived by</th>
                    <th className="px-3 py-2 font-medium">Archived</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((row) => {
                    const channelUrl = discordChannelUrl(guildId, row.channelId)
                    return (
                      <tr
                        key={row.channelId}
                        className="border-b border-line last:border-b-0"
                      >
                        <td className="px-3 py-2 text-sm">
                          <span className="font-medium">
                            {row.originalName}
                          </span>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {channelUrl ? (
                            <a
                              href={channelUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-mono text-xs text-accent hover:underline"
                              title="Open in Discord (channel is hidden — Discord may show 'Unknown channel' to non-sudo viewers)"
                            >
                              {row.channelId}
                            </a>
                          ) : (
                            <span
                              className="font-mono text-xs"
                              title="GUILD_ID unset — link disabled"
                            >
                              {row.channelId}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {row.originalCategoryId ? (
                            <span
                              className="font-mono text-xs"
                              title="Restore target category"
                            >
                              {row.originalCategoryId}
                            </span>
                          ) : (
                            <span className="text-ink-dim">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {row.archivedByUserId ? (
                            <span
                              className="font-mono text-xs"
                              title="Discord mention syntax"
                            >
                              {`<@${row.archivedByUserId}>`}
                            </span>
                          ) : (
                            <span className="text-ink-dim">—</span>
                          )}
                        </td>
                        <td
                          className="px-3 py-2 text-xs text-ink-dim whitespace-nowrap"
                          title={row.archivedAt.toISOString()}
                        >
                          {relTime(row.archivedAt)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {list.length === ROW_CAP && (
              <div className="px-3 py-2 text-[11px] text-ink-dim border-t border-line bg-bg-card2/40">
                Showing the {ROW_CAP} most recently-archived channels. Refine
                the search to find older rows.
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  )
}

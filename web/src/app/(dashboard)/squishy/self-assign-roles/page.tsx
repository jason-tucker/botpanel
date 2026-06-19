/**
 * /squishy/self-assign-roles — Self-assign role board management.
 *
 * Server component. Sudo-gated (Squishy sudo OR bot owner). Manages the
 * self-assign board: a list of entries the bot posts (one embed + toggle
 * button each) into a single configured Discord channel. Two entry kinds:
 *
 *  - kind='role'  — a plain Discord role. One "Add / Remove" toggle button.
 *    Source: the existing auto_join_roles list (quick-add) or any role snowflake.
 *  - kind='game'  — a squishybot game. Two buttons: Channel access (View)
 *    + LFG pings — wired through games prefs exactly as /games does.
 *
 * The destination channel is stored in `bot_settings` under key
 * `selfassign.channel_id`. Entries are ordered by `sort_order`.
 *
 * All writes delegate to the bot via the Redis command bus (selfassign.*
 * RPC verbs) — the bot owns the DB rows and any live Discord messages.
 *
 * See `./SelfAssignWriteUI.tsx` for the client island and
 * `web/src/app/api/squishy/self-assign-roles/` for the API surface.
 */
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { asc, eq } from 'drizzle-orm'
import { getSession } from '@/lib/auth/session'
import { resolveAccess } from '@/lib/auth/perms'
import { squishyDb } from '@/lib/db/squishy'
import {
  selfAssignEntries,
  games,
  autoJoinRoles,
  botSettings,
} from '@/lib/db/schema/squishy'
import { SelfAssignWriteUI } from './SelfAssignWriteUI'

export const dynamic = 'force-dynamic'

type EntryRow = {
  id: string
  kind: string
  refId: string
  label: string | null
  description: string | null
  emoji: string | null
  sortOrder: number
  enabled: boolean
  postedChannelId: string | null
  postedMessageId: string | null
  createdAt: Date
}

type GameRow = {
  id: string
  name: string
}

type AutoJoinRow = {
  roleId: string
}

async function loadEntries(): Promise<EntryRow[] | null> {
  try {
    return await squishyDb
      .select({
        id: selfAssignEntries.id,
        kind: selfAssignEntries.kind,
        refId: selfAssignEntries.refId,
        label: selfAssignEntries.label,
        description: selfAssignEntries.description,
        emoji: selfAssignEntries.emoji,
        sortOrder: selfAssignEntries.sortOrder,
        enabled: selfAssignEntries.enabled,
        postedChannelId: selfAssignEntries.postedChannelId,
        postedMessageId: selfAssignEntries.postedMessageId,
        createdAt: selfAssignEntries.createdAt,
      })
      .from(selfAssignEntries)
      .orderBy(asc(selfAssignEntries.sortOrder))
  } catch (err) {
    console.warn('[squishy/self-assign-roles] entries load failed', err)
    return null
  }
}

async function loadGames(): Promise<GameRow[] | null> {
  try {
    return await squishyDb
      .select({ id: games.id, name: games.name })
      .from(games)
      .orderBy(asc(games.name))
  } catch (err) {
    console.warn('[squishy/self-assign-roles] games load failed', err)
    return null
  }
}

async function loadAutoJoinRoles(): Promise<AutoJoinRow[] | null> {
  try {
    return await squishyDb
      .select({ roleId: autoJoinRoles.roleId })
      .from(autoJoinRoles)
      .orderBy(asc(autoJoinRoles.addedAt))
  } catch (err) {
    console.warn('[squishy/self-assign-roles] auto_join_roles load failed', err)
    return null
  }
}

async function loadChannelId(): Promise<string | null> {
  try {
    const rows = await squishyDb
      .select({ value: botSettings.value })
      .from(botSettings)
      .where(eq(botSettings.key, 'selfassign.channel_id'))
    if (rows.length === 0) return null
    const v = rows[0].value?.trim()
    return v && v.length > 0 ? v : null
  } catch (err) {
    console.warn('[squishy/self-assign-roles] channel_id load failed', err)
    return null
  }
}

export default async function SelfAssignRolesPage() {
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
            Self-assign role board management is sudo-only. Ask the bot owner to
            add your Discord ID to{' '}
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

  const [entriesRes, gamesRes, autoJoinRes, channelIdRes] =
    await Promise.allSettled([
      loadEntries(),
      loadGames(),
      loadAutoJoinRoles(),
      loadChannelId(),
    ])

  const entries = entriesRes.status === 'fulfilled' ? entriesRes.value : null
  const gamesList = gamesRes.status === 'fulfilled' ? gamesRes.value : null
  const autoJoinRolesList =
    autoJoinRes.status === 'fulfilled' ? autoJoinRes.value : null
  const channelId =
    channelIdRes.status === 'fulfilled' ? channelIdRes.value : null

  return (
    <main className="min-h-dvh p-6 sm:p-10">
      <div className="max-w-4xl mx-auto flex flex-col gap-6">
        <header className="flex items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold">Self-assign Roles</h1>
            <p className="text-sm text-ink-dim">
              Manage the self-assign board — a set of embeds the bot posts in a
              channel so members can toggle roles and game prefs themselves.
            </p>
          </div>
          <Link
            href="/me"
            className="text-sm text-ink-dim hover:text-ink whitespace-nowrap"
          >
            ← Dashboard
          </Link>
        </header>

        <SelfAssignWriteUI
          entries={entries}
          games={gamesList ?? []}
          autoJoinRoles={autoJoinRolesList ?? []}
          channelId={channelId}
        />
      </div>
    </main>
  )
}

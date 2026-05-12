/**
 * /squishy/roles — read-only Role-management overview.
 *
 * Server component. Sudo-gated (Squishy sudo OR bot owner). One page that
 * surfaces the three role-management surfaces Squishy currently exposes via
 * `/sudo → Settings` in Discord, so a viewer doesn't have to scroll through
 * three different modals to inspect the current state:
 *
 *   1. **Auto-join roles** (`auto_join_roles`) — roles applied to every new
 *      member on `guildMemberAdd`. Gated by `feature.auto_role_on_join`.
 *   2. **Color roles** (`color_roles`) — curated list members pick from with
 *      `/color`. Gated by `feature.color_roles`.
 *   3. **Reaction-role messages** (`reaction_role_messages` + the per-message
 *      `reaction_role_mappings`) — Discord messages the bot watches for
 *      reactions and toggles roles on. `expires_at != null` ⇒ temporary
 *      (e.g. game-night) — a daily check cleans the row + message at expiry.
 *
 * Tabs are server-side via a `?tab=join|color|reaction` query string so the
 * route is sharable and the page can stay a pure server component (no client
 * JS for the tab bar). Each tab loads its own dataset; failures degrade to a
 * per-tab "data unavailable" card so a single broken table never 500s the
 * whole page.
 *
 * The schema's reaction-role rows do NOT carry the message body (Discord owns
 * that — we only watch the message), so the per-message card renders the IDs
 * + mappings table + an "Open message in Discord" deep-link rather than
 * inlining the text. The deep-link is hidden when `GUILD_ID` is unset so we
 * never render a broken `https://discord.com/channels/<undefined>/...` URL.
 */
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { asc, inArray } from 'drizzle-orm'
import { getSession } from '@/lib/auth/session'
import { resolveAccess } from '@/lib/auth/perms'
import { env } from '@/lib/env'
import { squishyDb } from '@/lib/db/squishy'
import {
  autoJoinRoles,
  colorRoles,
  reactionRoleMessages,
  reactionRoleMappings,
} from '@/lib/db/schema/squishy'
import {
  discordChannelUrl,
  discordMessageUrl,
  relTime,
} from '@/lib/util/format'

export const dynamic = 'force-dynamic'

type TabKey = 'join' | 'color' | 'reaction'

type AutoJoinRow = {
  roleId: string
  addedByUserId: string | null
  addedAt: Date
}

type ColorRow = {
  roleId: string
  label: string
  sortOrder: number
  addedAt: Date
}

type ReactionMessageRow = {
  id: string
  channelId: string
  messageId: string
  anchorRoleId: string | null
  expiresAt: Date | null
  createdByUserId: string | null
  createdAt: Date
  mappings: { id: string; emoji: string; roleId: string }[]
}

function parseTab(raw: string | string[] | undefined): TabKey {
  const v = Array.isArray(raw) ? raw[0] : raw
  if (v === 'color' || v === 'reaction') return v
  return 'join'
}

async function loadAutoJoin(): Promise<AutoJoinRow[] | null> {
  try {
    return await squishyDb
      .select({
        roleId: autoJoinRoles.roleId,
        addedByUserId: autoJoinRoles.addedByUserId,
        addedAt: autoJoinRoles.addedAt,
      })
      .from(autoJoinRoles)
      .orderBy(asc(autoJoinRoles.addedAt))
  } catch (err) {
    console.warn('[squishy/roles] auto_join_roles load failed', err)
    return null
  }
}

async function loadColors(): Promise<ColorRow[] | null> {
  try {
    return await squishyDb
      .select({
        roleId: colorRoles.roleId,
        label: colorRoles.label,
        sortOrder: colorRoles.sortOrder,
        addedAt: colorRoles.addedAt,
      })
      .from(colorRoles)
      .orderBy(asc(colorRoles.sortOrder), asc(colorRoles.label))
  } catch (err) {
    console.warn('[squishy/roles] color_roles load failed', err)
    return null
  }
}

/**
 * Pull every reaction-role message + zip in its mappings.
 *
 * Two round trips, by design: the messages query is ordered (created_at desc)
 * and the mappings query is a single `where messagePk in (...)` so we never
 * fan out to N+1 individual lookups. We group in TS rather than a SQL join
 * because the row count is small (one bot, dozens of messages tops) and a
 * left-join + groupBy on `reaction_role_messages.id` would force us to
 * `array_agg` the mappings — fine, but the schema gives the mappings their
 * own `id` and we want to render each one as a distinct row.
 */
async function loadReactionMessages(): Promise<ReactionMessageRow[] | null> {
  try {
    const messages = await squishyDb
      .select({
        id: reactionRoleMessages.id,
        channelId: reactionRoleMessages.channelId,
        messageId: reactionRoleMessages.messageId,
        anchorRoleId: reactionRoleMessages.anchorRoleId,
        expiresAt: reactionRoleMessages.expiresAt,
        createdByUserId: reactionRoleMessages.createdByUserId,
        createdAt: reactionRoleMessages.createdAt,
      })
      .from(reactionRoleMessages)
      .orderBy(asc(reactionRoleMessages.createdAt))

    if (messages.length === 0) return []

    const ids = messages.map((m) => m.id)
    const mappings = await squishyDb
      .select({
        id: reactionRoleMappings.id,
        messagePk: reactionRoleMappings.messagePk,
        emoji: reactionRoleMappings.emoji,
        roleId: reactionRoleMappings.roleId,
      })
      .from(reactionRoleMappings)
      .where(inArray(reactionRoleMappings.messagePk, ids))

    const byMsg = new Map<string, ReactionMessageRow['mappings']>()
    for (const m of mappings) {
      const arr = byMsg.get(m.messagePk) ?? []
      arr.push({ id: m.id, emoji: m.emoji, roleId: m.roleId })
      byMsg.set(m.messagePk, arr)
    }

    return messages.map((msg) => ({
      ...msg,
      mappings: byMsg.get(msg.id) ?? [],
    }))
  } catch (err) {
    console.warn('[squishy/roles] reaction_role_messages load failed', err)
    return null
  }
}

function RoleMono({ roleId }: { roleId: string }) {
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <span className="font-mono text-xs">{roleId}</span>
      <span
        className="font-mono text-[10px] text-ink-dim"
        title="Discord mention syntax"
      >
        {`<@&${roleId}>`}
      </span>
    </span>
  )
}

function TabLink({
  href,
  label,
  active,
}: {
  href: string
  label: string
  active: boolean
}) {
  const base =
    'inline-flex items-center px-3 py-1.5 text-sm rounded-lg border transition-colors'
  const activeCls = 'border-line bg-bg-card2 text-ink'
  const idleCls =
    'border-transparent text-ink-dim hover:text-ink hover:bg-bg-card2/50'
  return (
    <Link href={href} className={`${base} ${active ? activeCls : idleCls}`}>
      {label}
    </Link>
  )
}

function UnavailableCard({ what }: { what: string }) {
  return (
    <div className="rounded-xl border border-line bg-bg-card p-6 text-sm text-err">
      Failed to load {what} — the SquishyBot database isn&apos;t reachable from
      the panel right now. Check{' '}
      <code className="font-mono text-xs">SQUISHY_DATABASE_URL</code> and
      container networking, then refresh.
    </div>
  )
}

function EmptyCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-bg-card p-6 text-sm text-ink-dim">
      {children}
    </div>
  )
}

function AutoJoinTab({ rows }: { rows: AutoJoinRow[] | null }) {
  if (rows === null) return <UnavailableCard what="auto-join roles" />
  if (rows.length === 0) {
    return (
      <EmptyCard>
        No auto-join roles. Add via{' '}
        <code className="font-mono text-xs">/sudo → Settings → Auto Roles</code>
        .
      </EmptyCard>
    )
  }
  return (
    <div className="rounded-xl border border-line bg-bg-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead className="bg-bg-card2 text-xs uppercase tracking-wider text-ink-dim">
            <tr>
              <th className="px-3 py-2 font-medium">Role ID</th>
              <th className="px-3 py-2 font-medium">Added by</th>
              <th className="px-3 py-2 font-medium">Added</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.roleId}
                className="border-b border-line last:border-b-0"
              >
                <td className="px-3 py-2">
                  <RoleMono roleId={r.roleId} />
                </td>
                <td className="px-3 py-2">
                  {r.addedByUserId ? (
                    <span
                      className="font-mono text-xs"
                      title="Discord mention syntax"
                    >{`<@${r.addedByUserId}>`}</span>
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
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ColorTab({ rows }: { rows: ColorRow[] | null }) {
  if (rows === null) return <UnavailableCard what="color roles" />
  if (rows.length === 0) {
    return (
      <EmptyCard>
        No curated colors. Add via{' '}
        <code className="font-mono text-xs">
          /sudo → Settings → Color Roles
        </code>
        .
      </EmptyCard>
    )
  }
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
      {rows.map((r) => (
        <div
          key={r.roleId}
          className="rounded-xl border border-line bg-bg-card p-3 flex flex-col gap-2"
        >
          {/* Schema doesn't carry a `hex` column — the bot stores the color
              on the Discord role itself. We render a neutral swatch as a
              visual placeholder; the label is the canonical identifier
              members see in `/color`. */}
          <div
            className="w-full h-10 rounded-md border border-line bg-bg-card2"
            aria-hidden
          />
          <div className="text-sm font-medium truncate" title={r.label}>
            {r.label}
          </div>
          <div className="text-[11px] text-ink-dim flex items-center justify-between gap-2">
            <span className="font-mono truncate" title={r.roleId}>
              {r.roleId}
            </span>
            <span className="tabular-nums shrink-0">#{r.sortOrder}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

function ReactionTab({
  rows,
  guildId,
}: {
  rows: ReactionMessageRow[] | null
  guildId: string | null
}) {
  if (rows === null) return <UnavailableCard what="reaction-role messages" />
  if (rows.length === 0) {
    return (
      <EmptyCard>
        No reaction-role messages. Build one via{' '}
        <code className="font-mono text-xs">
          /sudo → Settings → Reaction Roles
        </code>
        .
      </EmptyCard>
    )
  }
  return (
    <div className="flex flex-col gap-4">
      {rows.map((m) => {
        const channelUrl = discordChannelUrl(guildId, m.channelId)
        const messageUrl = discordMessageUrl(guildId, m.channelId, m.messageId)
        const isTemporary = m.expiresAt !== null
        const expired =
          m.expiresAt !== null && m.expiresAt.getTime() <= Date.now()
        return (
          <div
            key={m.id}
            className="rounded-xl border border-line bg-bg-card overflow-hidden"
          >
            <div className="p-4 flex flex-col gap-3 border-b border-line">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[10px] uppercase tracking-wider text-ink-dim">
                  Channel
                </span>
                {channelUrl ? (
                  <a
                    href={channelUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-xs text-accent hover:underline"
                    title="Open channel in Discord"
                  >
                    {m.channelId}
                  </a>
                ) : (
                  <span
                    className="font-mono text-xs text-ink-dim"
                    title="GUILD_ID unset — link disabled"
                  >
                    {m.channelId}
                  </span>
                )}
                <span className="text-ink-dim/40">·</span>
                <span className="text-[10px] uppercase tracking-wider text-ink-dim">
                  Message
                </span>
                <span className="font-mono text-xs" title={m.messageId}>
                  {m.messageId}
                </span>
                {isTemporary && (
                  <span
                    className={`text-[10px] uppercase tracking-wider rounded px-1.5 py-0.5 border ${
                      expired
                        ? 'border-line text-ink-dim'
                        : 'border-warn/40 text-warn'
                    }`}
                    title={m.expiresAt?.toISOString() ?? ''}
                  >
                    {expired ? 'expired' : 'temporary'}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-3 text-xs text-ink-dim">
                {m.anchorRoleId && (
                  <span>
                    anchor{' '}
                    <span className="font-mono text-[11px]">
                      {m.anchorRoleId}
                    </span>
                  </span>
                )}
                {m.expiresAt && (
                  <span title={m.expiresAt.toISOString()}>
                    {expired ? 'expired ' : 'expires '}
                    {relTime(m.expiresAt)}
                  </span>
                )}
                {m.createdByUserId && (
                  <span>
                    by{' '}
                    <span className="font-mono text-[11px]">{`<@${m.createdByUserId}>`}</span>
                  </span>
                )}
                <span title={m.createdAt.toISOString()}>
                  created {relTime(m.createdAt)}
                </span>
                {messageUrl && (
                  <a
                    href={messageUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent hover:underline ml-auto"
                  >
                    Open message in Discord →
                  </a>
                )}
              </div>
            </div>

            {m.mappings.length === 0 ? (
              <div className="p-4 text-xs text-ink-dim italic">
                No reaction mappings on this message yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-bg-card2 text-xs uppercase tracking-wider text-ink-dim">
                    <tr>
                      <th className="px-3 py-2 font-medium">Emoji</th>
                      <th className="px-3 py-2 font-medium">Role ID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {m.mappings.map((mp) => (
                      <tr
                        key={mp.id}
                        className="border-b border-line last:border-b-0"
                      >
                        <td className="px-3 py-2 text-base">
                          {/^\d+$/.test(mp.emoji) ? (
                            <span
                              className="font-mono text-xs text-ink-dim"
                              title="Custom emoji ID"
                            >
                              :{mp.emoji}:
                            </span>
                          ) : (
                            <span>{mp.emoji}</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <RoleMono roleId={mp.roleId} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export default async function SquishyRolesPage({
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
            Role-management overview is sudo-only. Ask the bot owner to add
            your Discord ID to{' '}
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
  const tab = parseTab(sp.tab)

  // Fire all three loads in parallel; each one's `try/catch` returns `null`
  // on failure so a single broken table doesn't doom the others. We use
  // Promise.allSettled defensively in case a future loader is added that
  // doesn't catch internally — the page should still render.
  const [autoJoinRes, colorsRes, reactionsRes] = await Promise.allSettled([
    loadAutoJoin(),
    loadColors(),
    loadReactionMessages(),
  ])
  const autoJoinRows =
    autoJoinRes.status === 'fulfilled' ? autoJoinRes.value : null
  const colorRows = colorsRes.status === 'fulfilled' ? colorsRes.value : null
  const reactionRows =
    reactionsRes.status === 'fulfilled' ? reactionsRes.value : null

  const guildId = env.GUILD_ID ?? null

  const counts = {
    join: autoJoinRows?.length ?? null,
    color: colorRows?.length ?? null,
    reaction: reactionRows?.length ?? null,
  }

  return (
    <main className="min-h-dvh p-6 sm:p-10">
      <div className="max-w-6xl mx-auto flex flex-col gap-6">
        <header className="flex items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold">Roles</h1>
            <p className="text-sm text-ink-dim">
              Read-only view of auto-join roles, curated color roles, and
              reaction-role messages.
            </p>
          </div>
          <Link
            href="/me"
            className="text-sm text-ink-dim hover:text-ink whitespace-nowrap"
          >
            ← Dashboard
          </Link>
        </header>

        {/* Tab bar — server-side, anchored on `?tab=...`. */}
        <nav className="flex flex-wrap gap-2" aria-label="Role surfaces">
          <TabLink
            href="/squishy/roles?tab=join"
            label={`Auto-join${counts.join !== null ? ` (${counts.join})` : ''}`}
            active={tab === 'join'}
          />
          <TabLink
            href="/squishy/roles?tab=color"
            label={`Color${counts.color !== null ? ` (${counts.color})` : ''}`}
            active={tab === 'color'}
          />
          <TabLink
            href="/squishy/roles?tab=reaction"
            label={`Reaction roles${
              counts.reaction !== null ? ` (${counts.reaction})` : ''
            }`}
            active={tab === 'reaction'}
          />
        </nav>

        {tab === 'join' && <AutoJoinTab rows={autoJoinRows} />}
        {tab === 'color' && <ColorTab rows={colorRows} />}
        {tab === 'reaction' && (
          <ReactionTab rows={reactionRows} guildId={guildId} />
        )}

        {tab === 'reaction' && !guildId && reactionRows && reactionRows.length > 0 && (
          <div className="text-xs text-ink-dim">
            <code className="font-mono">GUILD_ID</code> isn&apos;t set in the
            panel env — Discord deep-links are hidden. Set it in{' '}
            <code className="font-mono">.env</code> to enable per-message
            links.
          </div>
        )}
      </div>
    </main>
  )
}

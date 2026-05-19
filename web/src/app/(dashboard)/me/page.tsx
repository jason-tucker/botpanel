/**
 * /me — "My Dashboard".
 *
 * The first thing a signed-in user sees. Renders their identity card and a
 * human-readable view of the AccessMap so the user can verify exactly
 * what they can and can't do without having to click through every nav
 * link and read 403 cards.
 *
 * Layout: provided by the `(dashboard)` route-group layout — `<main>` and
 * the sidebar are already in scope. We just render content inside a `<div>`.
 */
import Image from 'next/image'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { inArray } from 'drizzle-orm'
import { getSession } from '@/lib/auth/session'
import { resolveAccess, type AccessMap, type BusinessRank } from '@/lib/auth/perms'
import { getViewAsUserId } from '@/lib/auth/viewAs'
import { resolveOneUsername } from '@/lib/userDisplay'
import { squishyDb, squishySchema } from '@/lib/db/squishy'
import { env } from '@/lib/env'

export const dynamic = 'force-dynamic'

function avatarUrl(id: string, hash: string | null | undefined): string | null {
  if (!hash) return null
  return `https://cdn.discordapp.com/avatars/${id}/${hash}.png?size=128`
}

function YesNo({ value }: { value: boolean }) {
  if (value) {
    return <span className="text-ok font-medium">Yes</span>
  }
  return <span className="text-ink-dim">No</span>
}

const RANK_LABEL: Record<BusinessRank, string> = {
  owner: 'Owner',
  manager: 'Manager',
  employee: 'Employee',
}

function RankPill({ rank }: { rank: BusinessRank }) {
  // Subtle color hint per rank so the list scans at a glance. Stick to the
  // palette tokens — no inline hex.
  const cls =
    rank === 'owner'
      ? 'border-ok/40 text-ok'
      : rank === 'manager'
        ? 'border-accent/40 text-accent'
        : 'border-line text-ink-dim'
  return (
    <span className={`inline-flex items-center rounded-full border ${cls} px-2 py-0.5 text-[10px] uppercase tracking-wider`}>
      {RANK_LABEL[rank]}
    </span>
  )
}

export default async function MePage() {
  const session = await getSession()
  // The layout already redirects un-authed visitors, but a defensive check
  // here means a stale layout cache can never leak this page.
  if (!session) redirect('/api/auth/login')

  // Honor View-As. The `(dashboard)` layout already resolved access with
  // the cookie, but the page resolves again — pages own their gates, the
  // layout's value is for the chrome. resolveAccess() silently ignores
  // the cookie for non-sudo callers, so this is safe.
  const viewAsUserId = await getViewAsUserId()
  const access: AccessMap = await resolveAccess(
    session,
    viewAsUserId ? { viewAsUserId } : undefined,
  )

  // When View-As is active, the identity card at the top should show the
  // VIEWED user, not the actor. The capability list below it already
  // reflects the viewed user (resolveAccess gave us their capabilities).
  // The actor's identity remains visible in the sidebar + banner.
  const viewAsActive = access.actor.id !== access.viewing.id
  let identityId = session.id
  let identityUsername = session.username
  let identityAvatarUrl = avatarUrl(session.id, session.avatar)
  if (viewAsActive) {
    identityId = access.viewing.id
    // resolveAccess fills `viewing.username` blank — fetch from the bot
    // for a friendly chip. Falls back to the raw ID if not cached.
    const resolved = await resolveOneUsername('squishy', access.viewing.id)
    identityUsername =
      resolved?.displayName ?? resolved?.username ?? access.viewing.id
    // The bot returns a fully-qualified avatar URL (or null). Reuse it
    // directly rather than rebuilding from a hash — we don't have the
    // hash on hand here.
    identityAvatarUrl = resolved?.avatarUrl ?? null
  }

  const avatar = identityAvatarUrl
  const businessEntries = Object.entries(access.otter.businesses).sort(([a], [b]) => a.localeCompare(b))
  const voiceCount = access.squishy.voiceChannels.length

  // Resolve voice channel IDs → display names. The auto_channels row carries
  // both the bot's last-known manual name and the auto-name template's
  // fallback; prefer manual, fall back to fallback, then to a generic label
  // so the UI never renders an empty title. Best-effort: if squishyDb is
  // unreachable we just fall through to the raw-ID rendering downstream.
  const voiceNames = new Map<string, string>()
  if (voiceCount > 0) {
    try {
      const rows = await squishyDb
        .select({
          voiceChannelId: squishySchema.autoChannels.voiceChannelId,
          manualName: squishySchema.autoChannels.manualName,
          fallbackName: squishySchema.autoChannels.fallbackName,
        })
        .from(squishySchema.autoChannels)
        .where(inArray(squishySchema.autoChannels.voiceChannelId, access.squishy.voiceChannels))
      for (const r of rows) {
        const name = (r.manualName?.trim() || r.fallbackName?.trim() || '').trim()
        if (name) voiceNames.set(r.voiceChannelId, name)
      }
    } catch {
      // Leave the map empty — IDs render as their own label.
    }
  }

  return (
    <div className="p-6 sm:p-10 pt-16 md:pt-10">
      <div className="max-w-3xl mx-auto flex flex-col gap-6">
        <header>
          <h1 className="text-2xl font-semibold">My Dashboard</h1>
          <p className="text-sm text-ink-dim mt-1">
            Your identity and capabilities, as the panel sees them.
          </p>
        </header>

        <section className="rounded-2xl border border-line bg-bg-card p-5 flex items-center gap-4">
          {avatar ? (
            // priority — this is the user's own avatar at the top of /me, above
            // the fold on every load. Worth the eager fetch to avoid a flash.
            <Image
              src={avatar}
              alt=""
              width={64}
              height={64}
              priority
              className="w-16 h-16 rounded-full border border-line"
            />
          ) : (
            <div className="w-16 h-16 rounded-full bg-bg-card2 border border-line flex items-center justify-center text-xl text-ink-dim">
              {identityUsername.slice(0, 1).toUpperCase()}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="font-medium text-lg text-ink truncate">
              {identityUsername}
              {viewAsActive && (
                <span className="ml-2 text-[10px] uppercase tracking-wider text-err align-middle">
                  (as)
                </span>
              )}
            </div>
            <div className="text-sm text-ink-dim font-mono truncate">{identityId}</div>
            {viewAsActive && (
              <div className="text-xs text-ink-dim mt-1">
                Your real account: <span className="font-mono">@{session.username}</span>
              </div>
            )}
            {access.botOwner && !viewAsActive && (
              <div className="inline-flex items-center gap-2 mt-2 rounded-full bg-bg-card2 border border-line px-3 py-1 text-xs">
                <span className="w-2 h-2 rounded-full bg-ok" /> Bot owner
              </div>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-line bg-bg-card p-5 flex flex-col gap-4">
          <h2 className="text-xs uppercase tracking-wider text-ink-dim">Capabilities</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="rounded-lg border border-line bg-bg-card2 p-3">
              <div className="text-xs text-ink-dim">Bot Owner</div>
              <div className="mt-1"><YesNo value={access.botOwner} /></div>
            </div>
            <div className="rounded-lg border border-line bg-bg-card2 p-3">
              <div className="text-xs text-ink-dim">Squishy sudo</div>
              <div className="mt-1"><YesNo value={access.squishy.sudo} /></div>
            </div>
          </div>

          <div className="rounded-lg border border-line bg-bg-card2 p-3 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <div className="text-xs text-ink-dim">Squishy voice channels you control</div>
              <div className="text-sm text-ink font-medium">{voiceCount}</div>
            </div>
            {voiceCount > 0 ? (
              <ul className="flex flex-col gap-1.5">
                {access.squishy.voiceChannels.map((id) => {
                  const name = voiceNames.get(id)
                  return (
                    <li key={id}>
                      <Link
                        href="/squishy/voice"
                        className="group flex items-center justify-between gap-3 rounded-lg border border-line bg-bg-card px-3 py-2 hover:border-accent hover:bg-bg-card/60 transition-colors"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-ink truncate">
                            {name ?? <span className="font-mono">{id}</span>}
                          </span>
                          {name && (
                            <span className="block text-[10px] font-mono text-ink-dim truncate">{id}</span>
                          )}
                        </span>
                        <span aria-hidden className="text-ink-dim group-hover:text-accent transition-colors">→</span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <div className="text-xs text-ink-dim">
                None right now. Voice channels you own (or are acting-owner of) will appear here while they exist.
              </div>
            )}
          </div>

          <div className="rounded-lg border border-line bg-bg-card2 p-3 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <div className="text-xs text-ink-dim">Otter businesses</div>
              <div className="text-sm text-ink font-medium">{businessEntries.length}</div>
            </div>
            {businessEntries.length > 0 ? (
              <ul className="flex flex-col gap-1.5">
                {businessEntries.map(([slug, rank]) => (
                  <li key={slug} className="flex items-center justify-between">
                    <Link
                      href={`/otter/businesses`}
                      className="text-sm text-ink hover:underline font-mono"
                    >
                      {slug}
                    </Link>
                    <RankPill rank={rank} />
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-xs text-ink-dim">
                You aren&apos;t mapped to any Otter business. Owners + managers will see entries here.
              </div>
            )}
          </div>
        </section>

        <details className="rounded-2xl border border-line bg-bg-card p-5 text-sm">
          <summary className="cursor-pointer text-ink-dim hover:text-ink select-none">
            Raw AccessMap (debug)
          </summary>
          <pre className="mt-3 overflow-x-auto text-xs font-mono text-ink-dim bg-bg-card2 border border-line rounded-lg p-3">
{JSON.stringify(access, null, 2)}
          </pre>
        </details>

        <footer className="text-xs text-ink-dim text-center">
          build <code className="font-mono">{env.GIT_SHA}</code>
        </footer>
      </div>
    </div>
  )
}

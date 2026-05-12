/**
 * /otter/businesses/[slug] — per-business detail.
 *
 * Gating: bot owner OR the viewer has a rank in this business via
 * `access.otter.businesses[slug]`. Non-permitted viewers (or viewers landing
 * on a slug that doesn't exist) see a friendly 404/403 card rather than a
 * redirect — the URL stays linkable from staff embeds.
 *
 * Each section's DB call is wrapped — Otter Postgres being briefly
 * unavailable degrades to "data unavailable" per card, not a whole-page
 * 500. The page metadata (header) still renders because we cache the
 * business row earlier in the request.
 *
 * Username resolution for Discord IDs is deferred to V2 (would need a bot
 * RPC). For now we render raw IDs in monospace plus a `<@id>` mention-format
 * helper that staff can paste into Discord to identify the user.
 *
 * Next 15: `params` is a Promise — must be awaited.
 */
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { eq, desc, sql } from 'drizzle-orm'
import { getSession } from '@/lib/auth/session'
import { resolveAccess, type BusinessRank } from '@/lib/auth/perms'
import { otterDb } from '@/lib/db/otter'
import { businesses, businessRoleMappings } from '@/lib/db/schema/otter/businesses'
import { businessOwners } from '@/lib/db/schema/otter/businessOwners'
import { standings } from '@/lib/db/schema/otter/standings'
import { auditLogs } from '@/lib/db/schema/otter/auditLogs'
import { notes } from '@/lib/db/schema/otter/notes'
import {
  rankColor,
  rankLabel,
  standingColor,
  providerColor,
  relTime,
} from '@/lib/util/otterFormat'
import {
  OwnersCard,
  RoleMappingsCard,
  SyncRolesCard,
  type Owner as OwnerCardRow,
  type Mapping as MappingCardRow,
} from './BusinessAdminControls'
import { EmployeePanel } from './EmployeePanel'

// MKE staff are managed on the external mke.euphoric.gg portal, so
// /otter/businesses/mckenzie does NOT mount EmployeePanel — the
// /otter/mke link-out page is the canonical surface. Both the seeded
// `mckenzie` slug and the legacy `mke` alias are excluded.
const MKE_SLUGS = new Set(['mckenzie', 'mke'])

export const dynamic = 'force-dynamic'

const RECENT_LIMIT = 20

type BusinessRow = {
  id: string
  name: string
  slug: string
  providerType: 'mckenzie' | 'discord-only'
  guildId: string
  active: boolean
  createdAt: Date
}

async function loadBusiness(slug: string): Promise<BusinessRow | null> {
  try {
    const rows = await otterDb
      .select({
        id: businesses.id,
        name: businesses.name,
        slug: businesses.slug,
        providerType: businesses.providerType,
        guildId: businesses.guildId,
        active: businesses.active,
        createdAt: businesses.createdAt,
      })
      .from(businesses)
      .where(eq(businesses.slug, slug))
      .limit(1)
    return rows[0] ?? null
  } catch (err) {
    console.warn('[otter/businesses/:slug] business load failed', err)
    return null
  }
}

function NotFoundCard({ slug }: { slug: string }) {
  return (
    <main className="min-h-dvh p-6 sm:p-10">
      <div className="max-w-md mx-auto rounded-2xl border border-line bg-bg-card p-6 flex flex-col gap-3">
        <h1 className="text-xl font-semibold">404 — Business not found</h1>
        <p className="text-ink-dim text-sm">
          No active or deactivated business with slug{' '}
          <code className="font-mono text-xs">{slug}</code>. It may have been
          renamed, or you may not have access to view it.
        </p>
        <Link href="/otter/businesses" className="text-sm text-accent underline self-start">
          ← All businesses
        </Link>
      </div>
    </main>
  )
}

function ForbiddenCard({ slug }: { slug: string }) {
  return (
    <main className="min-h-dvh p-6 sm:p-10">
      <div className="max-w-md mx-auto rounded-2xl border border-line bg-bg-card p-6 flex flex-col gap-3">
        <h1 className="text-xl font-semibold">403 — Not allowed</h1>
        <p className="text-ink-dim text-sm">
          You don&apos;t have a rank in{' '}
          <code className="font-mono text-xs">{slug}</code>. Ask an owner or
          manager of that business to add you via{' '}
          <code className="font-mono text-xs">/portal</code> in Discord.
        </p>
        <Link href="/otter/businesses" className="text-sm text-accent underline self-start">
          ← All businesses
        </Link>
      </div>
    </main>
  )
}

function Unavailable({ what }: { what: string }) {
  return (
    <p className="text-ink-dim text-sm italic">
      {what} data is currently unavailable.
    </p>
  )
}

function pillClass(extra: string): string {
  return `inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${extra}`
}

export default async function BusinessDetailPage(
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params

  const session = await getSession()
  if (!session) redirect('/api/auth/login')

  const access = await resolveAccess(session)
  const explicitRank = access.otter.businesses[slug]
  const synthRank: BusinessRank | 'bot-owner' | null =
    explicitRank ?? (access.botOwner ? 'bot-owner' : null)

  if (!explicitRank && !access.botOwner) {
    return <ForbiddenCard slug={slug} />
  }

  const biz = await loadBusiness(slug)
  if (!biz) return <NotFoundCard slug={slug} />

  // Now load each section in parallel. Each promise resolves to a
  // discriminated union — `{ ok: true, data }` or `{ ok: false }` — so the
  // renderer can swap in an "unavailable" placeholder per card without
  // letting a single failed query 500 the whole page.
  type Loaded<T> = { ok: true; data: T } | { ok: false }

  type Owner = { id: string; discordUserId: string; addedAt: Date | null }
  type Mapping = {
    id: string
    roleId: string
    roleName: string | null
    rank: BusinessRank
    isBase: boolean
    autoGrantEmployee: boolean
    minRankToAssign: BusinessRank
    label: string | null
  }
  type Standing = {
    id: string
    characterId: string
    characterName: string
    standing: 'good' | 'neutral' | 'bad' | 'blacklisted'
    reason: string | null
    updatedAt: Date
  }
  type Audit = {
    id: string
    actorDiscordId: string
    actorName: string
    action: string
    targetType: string | null
    targetId: string | null
    success: boolean
    details: Record<string, unknown> | null
    createdAt: Date
  }
  type NoteCount = { visibility: string; n: number }

  const [ownersR, mappingsR, standingsR, auditR, notesR] = await Promise.all([
    otterDb
      .select({
        id: businessOwners.id,
        discordUserId: businessOwners.discordUserId,
        addedAt: businessOwners.addedAt,
      })
      .from(businessOwners)
      .where(eq(businessOwners.businessId, biz.id))
      .then((r): Loaded<Owner[]> => ({ ok: true, data: r }))
      .catch((err: unknown) => {
        console.warn('[otter/businesses/:slug] owners load failed', err)
        return { ok: false } as Loaded<Owner[]>
      }),
    otterDb
      .select({
        id: businessRoleMappings.id,
        roleId: businessRoleMappings.roleId,
        roleName: businessRoleMappings.roleName,
        rank: businessRoleMappings.rank,
        isBase: businessRoleMappings.isBase,
        autoGrantEmployee: businessRoleMappings.autoGrantEmployee,
        minRankToAssign: businessRoleMappings.minRankToAssign,
        label: businessRoleMappings.label,
      })
      .from(businessRoleMappings)
      .where(eq(businessRoleMappings.businessId, biz.id))
      .then((r): Loaded<Mapping[]> => ({ ok: true, data: r }))
      .catch((err: unknown) => {
        console.warn('[otter/businesses/:slug] role mappings load failed', err)
        return { ok: false } as Loaded<Mapping[]>
      }),
    otterDb
      .select({
        id: standings.id,
        characterId: standings.characterId,
        characterName: standings.characterName,
        standing: standings.standing,
        reason: standings.reason,
        updatedAt: standings.updatedAt,
      })
      .from(standings)
      .where(eq(standings.businessId, biz.id))
      .orderBy(desc(standings.updatedAt))
      .limit(RECENT_LIMIT)
      .then((r): Loaded<Standing[]> => ({ ok: true, data: r }))
      .catch((err: unknown) => {
        console.warn('[otter/businesses/:slug] standings load failed', err)
        return { ok: false } as Loaded<Standing[]>
      }),
    otterDb
      .select({
        id: auditLogs.id,
        actorDiscordId: auditLogs.actorDiscordId,
        actorName: auditLogs.actorName,
        action: auditLogs.action,
        targetType: auditLogs.targetType,
        targetId: auditLogs.targetId,
        success: auditLogs.success,
        details: auditLogs.details,
        createdAt: auditLogs.createdAt,
      })
      .from(auditLogs)
      .where(eq(auditLogs.businessId, biz.id))
      .orderBy(desc(auditLogs.createdAt))
      .limit(RECENT_LIMIT)
      .then((r): Loaded<Audit[]> => ({ ok: true, data: r }))
      .catch((err: unknown) => {
        console.warn('[otter/businesses/:slug] audit load failed', err)
        return { ok: false } as Loaded<Audit[]>
      }),
    otterDb
      .select({
        visibility: notes.visibility,
        n: sql<number>`count(*)::int`,
      })
      .from(notes)
      .where(eq(notes.businessId, biz.id))
      .groupBy(notes.visibility)
      .then((r): Loaded<NoteCount[]> => ({ ok: true, data: r.map((row) => ({ visibility: row.visibility, n: Number(row.n) })) }))
      .catch((err: unknown) => {
        console.warn('[otter/businesses/:slug] notes count failed', err)
        return { ok: false } as Loaded<NoteCount[]>
      }),
  ])

  // Sorting is delegated to <RoleMappingsCard> so the read-only and the
  // edit-enabled paths share the exact same ordering.
  const canEditMappings =
    access.botOwner || access.otter.businesses[slug] === 'owner'

  // Wave 7c-B / 7e — employee hire/fire/promote/demote panel. Only
  // rendered for manager+ on this business (or bot owner), and never for
  // MKE — its staff are managed on the external mke.euphoric.gg portal.
  // The Members list inside the panel is now a live RPC fetch keyed on
  // slug, so we no longer need to pass a server-rendered owner roster.
  const viewerOwnsBusiness =
    access.botOwner || access.otter.businesses[slug] === 'owner'
  const viewerCanManageEmployees =
    !MKE_SLUGS.has(slug) &&
    (access.botOwner ||
      access.otter.businesses[slug] === 'owner' ||
      access.otter.businesses[slug] === 'manager')

  return (
    <main className="min-h-dvh p-6 sm:p-10">
      <div className="max-w-6xl mx-auto flex flex-col gap-6">
        <header className="flex flex-col gap-3">
          <Link
            href="/otter/businesses"
            className="text-sm text-ink-dim hover:text-ink self-start"
          >
            ← All businesses
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold">{biz.name}</h1>
            <span className={pillClass(providerColor(biz.providerType))}>
              {biz.providerType}
            </span>
            {biz.active ? (
              <span className={pillClass('bg-ok/15 text-ok border-ok/30')}>
                Active
              </span>
            ) : (
              <span className={pillClass('bg-err/15 text-err border-err/30')}>
                Deactivated
              </span>
            )}
            {synthRank && (
              <span className={pillClass(rankColor(synthRank))}>
                Your rank: {rankLabel(synthRank)}
              </span>
            )}
          </div>
          <div className="flex items-center gap-4 text-xs text-ink-dim font-mono">
            <span>slug: {biz.slug}</span>
            <span>guild: {biz.guildId}</span>
            <span>created: {relTime(biz.createdAt)}</span>
          </div>
        </header>

        {/* Owners */}
        {ownersR.ok ? (
          <OwnersCard
            slug={slug}
            owners={ownersR.data as OwnerCardRow[]}
            isBotOwner={access.botOwner}
          />
        ) : (
          <section className="rounded-2xl border border-line bg-bg-card p-5 flex flex-col gap-3">
            <h2 className="text-xs uppercase tracking-wider text-ink-dim">
              Owners
            </h2>
            <Unavailable what="Owner" />
          </section>
        )}

        {/* Employee management — Wave 7c-B / 7e (live roster) */}
        {viewerCanManageEmployees && (
          <EmployeePanel slug={slug} canActAsOwner={viewerOwnsBusiness} />
        )}

        {/* Role mappings */}
        {mappingsR.ok ? (
          <RoleMappingsCard
            slug={slug}
            mappings={mappingsR.data as MappingCardRow[]}
            canEdit={canEditMappings}
          />
        ) : (
          <section className="rounded-2xl border border-line bg-bg-card p-5 flex flex-col gap-3">
            <h2 className="text-xs uppercase tracking-wider text-ink-dim">
              Role mappings
            </h2>
            <Unavailable what="Role mapping" />
          </section>
        )}

        {/* Sync roles to Discord — owner-only */}
        <SyncRolesCard
          slug={slug}
          isOwner={access.otter.businesses[slug] === 'owner'}
        />

        {/* Recent standings */}
        <section className="rounded-2xl border border-line bg-bg-card p-5 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xs uppercase tracking-wider text-ink-dim">
              Recent standings {standingsR.ok && <span className="text-ink">(last {standingsR.data.length})</span>}
            </h2>
            <Link
              href={`/otter/businesses/${slug}/standings`}
              className="text-xs text-accent hover:underline whitespace-nowrap"
            >
              View all standings →
            </Link>
          </div>
          {!standingsR.ok ? (
            <Unavailable what="Standings" />
          ) : standingsR.data.length === 0 ? (
            <p className="text-ink-dim text-sm">No standings recorded yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {standingsR.data.map((s) => (
                <li
                  key={s.id}
                  className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 rounded-lg border border-line bg-bg-card2 px-3 py-2"
                >
                  <span className={pillClass(standingColor(s.standing))}>
                    {s.standing}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{s.characterName}</div>
                    <div className="font-mono text-xs text-ink-dim truncate">
                      {s.characterId}
                    </div>
                  </div>
                  {s.reason && (
                    <div className="text-sm text-ink-dim line-clamp-2 sm:max-w-md">
                      {s.reason}
                    </div>
                  )}
                  <span className="text-xs text-ink-dim whitespace-nowrap">
                    {relTime(s.updatedAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Recent audit */}
        <section className="rounded-2xl border border-line bg-bg-card p-5 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xs uppercase tracking-wider text-ink-dim">
              Recent audit {auditR.ok && <span className="text-ink">(last {auditR.data.length})</span>}
            </h2>
            <Link
              href={`/otter/businesses/${slug}/audit`}
              className="text-xs text-accent hover:underline whitespace-nowrap"
            >
              View all audit →
            </Link>
          </div>
          {!auditR.ok ? (
            <Unavailable what="Audit" />
          ) : auditR.data.length === 0 ? (
            <p className="text-ink-dim text-sm">No audit entries for this business.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {auditR.data.map((a) => (
                <li key={a.id} className="rounded-lg border border-line bg-bg-card2 px-3 py-2">
                  <details className="group">
                    <summary className="flex flex-wrap items-center gap-3 cursor-pointer list-none">
                      <span
                        className={pillClass(
                          a.success
                            ? 'bg-ok/15 text-ok border-ok/30'
                            : 'bg-err/15 text-err border-err/30',
                        )}
                      >
                        {a.success ? '✓' : '✗'}
                      </span>
                      <span className="font-mono text-sm flex-1 min-w-0 truncate">
                        {a.action}
                      </span>
                      <span className="text-xs text-ink-dim font-mono truncate">
                        {a.actorName} · {a.actorDiscordId}
                      </span>
                      <span className="text-xs text-ink-dim whitespace-nowrap">
                        {relTime(a.createdAt)}
                      </span>
                    </summary>
                    <pre className="mt-2 text-xs text-ink-dim font-mono whitespace-pre-wrap break-all bg-bg p-2 rounded border border-line">
                      {JSON.stringify(
                        {
                          target: a.targetType
                            ? `${a.targetType}/${a.targetId ?? '?'}`
                            : a.targetId ?? null,
                          details: a.details,
                        },
                        null,
                        2,
                      )}
                    </pre>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Notes summary */}
        <section className="rounded-2xl border border-line bg-bg-card p-5 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xs uppercase tracking-wider text-ink-dim">Notes summary</h2>
            <Link
              href={`/otter/businesses/${slug}/notes`}
              className="text-xs text-accent hover:underline whitespace-nowrap"
            >
              View all notes →
            </Link>
          </div>
          {!notesR.ok ? (
            <Unavailable what="Notes" />
          ) : notesR.data.length === 0 ? (
            <p className="text-ink-dim text-sm">No notes recorded for this business.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {(['staff', 'manager', 'owner'] as const).map((v) => {
                const found = notesR.data.find((r) => r.visibility === v)
                const n = found ? found.n : 0
                return (
                  <div
                    key={v}
                    className="rounded-lg border border-line bg-bg-card2 px-3 py-3 flex items-center justify-between"
                  >
                    <div>
                      <div className="text-xs uppercase tracking-wider text-ink-dim">
                        {v}
                      </div>
                      <div className="text-xs text-ink-dim mt-1">
                        visibility
                      </div>
                    </div>
                    <div className="text-2xl font-semibold tabular-nums">{n}</div>
                  </div>
                )
              })}
            </div>
          )}
          <p className="text-xs text-ink-dim italic">
            Note content is gated per-rank; this page only shows aggregate
            counts. Use &ldquo;View all notes&rdquo; for the visibility-gated
            list.
          </p>
        </section>
      </div>
    </main>
  )
}

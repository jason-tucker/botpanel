/**
 * /otter/mke — McKenzie staff roster page.
 *
 * Thin wrapper around the MKE business roster, but the page intentionally
 * starts with two prominent link-out cards (Lookup client / Lookup employee)
 * that send the operator to https://mke.euphoric.gg/employee/portal/clients.
 * Per the Wave 7c plan, MKE lookups are NEVER in-dashboard — we link out to
 * the canonical staff portal rather than mirroring its surface here.
 *
 * Below the link-outs we render a read-only Owners + Role mappings view for
 * the `mke` business slug. Full edit (add owner, add/edit/remove role
 * mappings) continues to live at /otter/businesses/mke — there's a clearly
 * labelled link to that page at the bottom of this one.
 *
 * Gating: `access.otter.businesses.mke != null || access.botOwner`. Anyone
 * who isn't on the MKE roster gets a 403 card. Bot owner can always see it.
 *
 * DB unavailable: each Drizzle call is wrapped so a downed Otter Postgres
 * degrades to "data unavailable" per-card rather than 500-ing the page.
 */
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { ExternalLink } from 'lucide-react'
import { getSession } from '@/lib/auth/session'
import { resolveAccess, type BusinessRank } from '@/lib/auth/perms'
import { otterDb } from '@/lib/db/otter'
import { businesses, businessRoleMappings } from '@/lib/db/schema/otter/businesses'
import { businessOwners } from '@/lib/db/schema/otter/businessOwners'
import {
  rankColor,
  rankLabel,
  providerColor,
  relTime,
} from '@/lib/util/otterFormat'

export const dynamic = 'force-dynamic'

const MKE_SLUG = 'mke'
const LOOKUP_URL = 'https://mke.euphoric.gg/employee/portal/clients'

type BusinessRow = {
  id: string
  name: string
  slug: string
  providerType: 'mckenzie' | 'discord-only'
  guildId: string
  active: boolean
  createdAt: Date
}

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

type Loaded<T> = { ok: true; data: T } | { ok: false }

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
    console.warn('[otter/mke] business load failed', err)
    return null
  }
}

function ForbiddenCard() {
  return (
    <main className="min-h-dvh p-6 sm:p-10">
      <div className="max-w-md mx-auto rounded-2xl border border-line bg-bg-card p-6 flex flex-col gap-3">
        <h1 className="text-xl font-semibold">403 — Not allowed</h1>
        <p className="text-ink-dim text-sm">
          You don&apos;t have a rank in McKenzie. Ask an MKE owner or manager
          to add you via{' '}
          <code className="font-mono text-xs">/portal</code> in Discord.
        </p>
        <Link
          href="/otter/businesses"
          className="text-sm text-accent underline self-start"
        >
          ← All businesses
        </Link>
      </div>
    </main>
  )
}

function NotFoundCard() {
  return (
    <main className="min-h-dvh p-6 sm:p-10">
      <div className="max-w-md mx-auto rounded-2xl border border-line bg-bg-card p-6 flex flex-col gap-3">
        <h1 className="text-xl font-semibold">McKenzie business not found</h1>
        <p className="text-ink-dim text-sm">
          No business with slug{' '}
          <code className="font-mono text-xs">{MKE_SLUG}</code> is configured
          in Otter Postgres. Ask an owner to create it via Discord.
        </p>
        <Link
          href="/otter/businesses"
          className="text-sm text-accent underline self-start"
        >
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

function rankOrder(rank: BusinessRank): number {
  if (rank === 'owner') return 0
  if (rank === 'manager') return 1
  return 2
}

function LookupCard({
  title,
  description,
}: {
  title: string
  description: string
}): React.JSX.Element {
  return (
    <a
      href={LOOKUP_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="group rounded-2xl border border-accent/40 bg-accent/10 hover:bg-accent/15 hover:border-accent/60 transition p-5 flex flex-col gap-3"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-lg font-semibold text-ink group-hover:text-accent">
          {title}
        </h2>
        <ExternalLink className="w-5 h-5 text-accent shrink-0" aria-hidden />
      </div>
      <p className="text-sm text-ink-dim">{description}</p>
      <div className="mt-auto pt-1 text-xs text-ink-dim font-mono truncate">
        {LOOKUP_URL}
      </div>
    </a>
  )
}

export default async function MkeStaffPage() {
  const session = await getSession()
  if (!session) redirect('/api/auth/login')

  const access = await resolveAccess(session)
  const explicitRank = access.otter.businesses[MKE_SLUG]
  const synthRank: BusinessRank | 'bot-owner' | null =
    explicitRank ?? (access.botOwner ? 'bot-owner' : null)

  if (!explicitRank && !access.botOwner) {
    return <ForbiddenCard />
  }

  const biz = await loadBusiness(MKE_SLUG)
  if (!biz) return <NotFoundCard />

  const [ownersR, mappingsR] = await Promise.all([
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
        console.warn('[otter/mke] owners load failed', err)
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
        console.warn('[otter/mke] role mappings load failed', err)
        return { ok: false } as Loaded<Mapping[]>
      }),
  ])

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
          <p className="text-sm text-ink-dim">
            MKE staff page. Client + employee lookups live in the McKenzie
            staff portal — use the link-outs below.
          </p>
        </header>

        {/* Link-out cards — primary action on this page. */}
        <section className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <LookupCard
            title="Lookup a client"
            description="Open the McKenzie staff portal to search and view client records."
          />
          <LookupCard
            title="Lookup employee"
            description="Open the McKenzie staff portal to view employee directory + portal accounts."
          />
        </section>

        {/* Owners — read-only on this page; edit lives at /otter/businesses/mke. */}
        <section className="rounded-2xl border border-line bg-bg-card p-5 flex flex-col gap-3">
          <h2 className="text-xs uppercase tracking-wider text-ink-dim">
            Owners{' '}
            {ownersR.ok && (
              <span className="text-ink">({ownersR.data.length})</span>
            )}
          </h2>
          {!ownersR.ok ? (
            <Unavailable what="Owner" />
          ) : ownersR.data.length === 0 ? (
            <p className="text-ink-dim text-sm">No owners recorded.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {ownersR.data.map((o) => (
                <li
                  key={o.id}
                  className="flex flex-wrap items-center gap-3 justify-between rounded-lg border border-line bg-bg-card2 px-3 py-2"
                >
                  <code className="font-mono text-sm">{o.discordUserId}</code>
                  <span className="text-xs text-ink-dim font-mono">
                    {`<@${o.discordUserId}>`}
                  </span>
                  <span className="text-xs text-ink-dim">
                    added {relTime(o.addedAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Role mappings — read-only here, sorted by rank then label/name. */}
        <section className="rounded-2xl border border-line bg-bg-card p-5 flex flex-col gap-3">
          <h2 className="text-xs uppercase tracking-wider text-ink-dim">
            Role mappings{' '}
            {mappingsR.ok && (
              <span className="text-ink">({mappingsR.data.length})</span>
            )}
          </h2>
          {!mappingsR.ok ? (
            <Unavailable what="Role mapping" />
          ) : mappingsR.data.length === 0 ? (
            <p className="text-ink-dim text-sm">No role mappings configured.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {[...mappingsR.data]
                .sort((a, b) => {
                  const o = rankOrder(a.rank) - rankOrder(b.rank)
                  if (o !== 0) return o
                  const aLabel = a.label ?? a.roleName ?? a.roleId
                  const bLabel = b.label ?? b.roleName ?? b.roleId
                  return aLabel.localeCompare(bLabel)
                })
                .map((m) => (
                  <li
                    key={m.id}
                    className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-bg-card2 px-3 py-2"
                  >
                    <span className={pillClass(rankColor(m.rank))}>
                      {rankLabel(m.rank)}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">
                        {m.label ?? m.roleName ?? 'unnamed role'}
                      </div>
                      <div className="font-mono text-xs text-ink-dim truncate">
                        {m.roleId}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-ink-dim">
                      {m.isBase && (
                        <span className={pillClass('bg-accent/10 text-accent border-accent/30')}>
                          base
                        </span>
                      )}
                      {m.autoGrantEmployee && (
                        <span className={pillClass('bg-ok/10 text-ok border-ok/30')}>
                          auto-grant employee
                        </span>
                      )}
                      <span>
                        assignable by ≥ {rankLabel(m.minRankToAssign)}
                      </span>
                    </div>
                  </li>
                ))}
            </ul>
          )}
        </section>

        {/* Edit jumpoff — full mapping/owner CRUD lives on the business detail page. */}
        <section className="rounded-2xl border border-line bg-bg-card p-5 flex flex-col gap-3">
          <h2 className="text-xs uppercase tracking-wider text-ink-dim">
            Edit
          </h2>
          <p className="text-sm text-ink-dim">
            Owner + role-mapping edit (add / remove / change rank) lives on
            the business detail page. Notes and standings for MKE staff also
            live there.
          </p>
          <Link
            href={`/otter/businesses/${MKE_SLUG}`}
            className="text-sm text-accent hover:underline self-start"
          >
            Edit MKE business →
          </Link>
        </section>
      </div>
    </main>
  )
}

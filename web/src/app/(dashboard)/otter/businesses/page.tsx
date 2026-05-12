/**
 * /otter/businesses — index of all businesses the viewer has any access to.
 *
 * Gating:
 *  - Bot owner: sees every business (including deactivated ones, rendered faded).
 *  - Everyone else: only businesses where they appear in `access.otter.businesses`
 *    (either via a role mapping or explicit ownership).
 *  - No business access AND not bot owner → "No business access" card. We
 *    don't 403 because this URL is bookmarked in the sidebar; it's friendlier
 *    to explain what's going on.
 *
 * DB failure: each query is wrapped — if the Drizzle call throws (bot DB
 * unreachable, env var missing, etc.) we surface a small "data unavailable"
 * card instead of letting the page 500. The capability map is already
 * degrade-safe via `resolveAccess`'s own try/catch.
 *
 * Owner-count + role-mapping-count: one COUNT per business would be N+1.
 * Instead we grab both as `groupBy(businessId)` aggregates and join in JS.
 */
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { sql, inArray } from 'drizzle-orm'
import { getSession } from '@/lib/auth/session'
import { resolveAccess, type BusinessRank } from '@/lib/auth/perms'
import { otterDb } from '@/lib/db/otter'
import { businesses, businessRoleMappings } from '@/lib/db/schema/otter/businesses'
import { businessOwners } from '@/lib/db/schema/otter/businessOwners'
import { rankColor, rankLabel, providerColor } from '@/lib/util/otterFormat'

export const dynamic = 'force-dynamic'

type BusinessRow = {
  id: string
  name: string
  slug: string
  providerType: 'mckenzie' | 'discord-only'
  guildId: string
  active: boolean
}

type LoadResult = {
  rows: BusinessRow[]
  ownerCounts: Map<string, number>
  mappingCounts: Map<string, number>
  error?: string
}

async function loadBusinesses(opts: {
  botOwner: boolean
  accessSlugs: string[]
}): Promise<LoadResult> {
  try {
    // Bot owner sees deactivated rows too (faded card). Everyone else only
    // sees businesses they're attached to AND that are still active — the
    // `(active = true OR botOwner)` predicate is easier to express in JS.
    const allRows = await otterDb
      .select({
        id: businesses.id,
        name: businesses.name,
        slug: businesses.slug,
        providerType: businesses.providerType,
        guildId: businesses.guildId,
        active: businesses.active,
      })
      .from(businesses)

    const filtered = allRows.filter((b) => {
      if (opts.botOwner) return true
      if (!b.active) return false
      return opts.accessSlugs.includes(b.slug)
    })

    if (filtered.length === 0) {
      return { rows: [], ownerCounts: new Map(), mappingCounts: new Map() }
    }

    const ids = filtered.map((b) => b.id)

    const ownerCounts = new Map<string, number>()
    const mappingCounts = new Map<string, number>()

    try {
      const ownerAgg = await otterDb
        .select({
          businessId: businessOwners.businessId,
          n: sql<number>`count(*)::int`,
        })
        .from(businessOwners)
        .where(inArray(businessOwners.businessId, ids))
        .groupBy(businessOwners.businessId)
      for (const r of ownerAgg) ownerCounts.set(r.businessId, Number(r.n))
    } catch (err) {
      console.warn('[otter/businesses] owner count agg failed', err)
    }

    try {
      const mapAgg = await otterDb
        .select({
          businessId: businessRoleMappings.businessId,
          n: sql<number>`count(*)::int`,
        })
        .from(businessRoleMappings)
        .where(inArray(businessRoleMappings.businessId, ids))
        .groupBy(businessRoleMappings.businessId)
      for (const r of mapAgg) mappingCounts.set(r.businessId, Number(r.n))
    } catch (err) {
      console.warn('[otter/businesses] mapping count agg failed', err)
    }

    return { rows: filtered, ownerCounts, mappingCounts }
  } catch (err) {
    console.warn('[otter/businesses] index load failed', err)
    return {
      rows: [],
      ownerCounts: new Map(),
      mappingCounts: new Map(),
      error: 'Business data is currently unavailable.',
    }
  }
}

function rankFor(
  b: BusinessRow,
  access: { botOwner: boolean; otter: { businesses: Record<string, BusinessRank> } },
): BusinessRank | 'bot-owner' | null {
  const explicit = access.otter.businesses[b.slug]
  if (explicit) return explicit
  if (access.botOwner) return 'bot-owner'
  return null
}

export default async function BusinessesIndexPage() {
  const session = await getSession()
  if (!session) redirect('/api/auth/login')

  const access = await resolveAccess(session)
  const accessSlugs = Object.keys(access.otter.businesses)

  // Empty-access shortcut: don't even hit the DB if there's no possible result.
  if (!access.botOwner && accessSlugs.length === 0) {
    return (
      <main className="min-h-dvh p-6 sm:p-10">
        <div className="max-w-3xl mx-auto flex flex-col gap-6">
          <header className="flex items-center justify-between">
            <h1 className="text-2xl font-semibold">Otter — Businesses</h1>
            <Link href="/me" className="text-sm text-ink-dim hover:text-ink">← Dashboard</Link>
          </header>
          <section className="rounded-2xl border border-line bg-bg-card p-6 flex flex-col gap-3">
            <h2 className="text-lg font-semibold">No business access</h2>
            <p className="text-ink-dim text-sm">
              Your Discord account isn&apos;t attached to any Otter business in
              this server. Owners and managers can grant you a role via{' '}
              <code className="font-mono text-xs">/portal</code> in Discord;
              once you have a mapped role you&apos;ll see it listed here.
            </p>
          </section>
        </div>
      </main>
    )
  }

  const { rows, ownerCounts, mappingCounts, error } = await loadBusinesses({
    botOwner: access.botOwner,
    accessSlugs,
  })

  // Sort: active before inactive, then alpha by name.
  const sorted = [...rows].sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1
    return a.name.localeCompare(b.name)
  })

  return (
    <main className="min-h-dvh p-6 sm:p-10">
      <div className="max-w-6xl mx-auto flex flex-col gap-6">
        <header className="flex items-center justify-between">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold">Otter — Businesses</h1>
            <p className="text-sm text-ink-dim">
              {access.botOwner
                ? 'Showing every business (bot owner view).'
                : `Showing ${sorted.length} business${sorted.length === 1 ? '' : 'es'} you have access to.`}
            </p>
          </div>
          <Link href="/me" className="text-sm text-ink-dim hover:text-ink">← Dashboard</Link>
        </header>

        {error && (
          <section className="rounded-2xl border border-warn/30 bg-warn/5 p-4 text-sm text-warn">
            {error}
          </section>
        )}

        {sorted.length === 0 && !error && (
          <section className="rounded-2xl border border-line bg-bg-card p-6">
            <p className="text-ink-dim text-sm">No businesses to show.</p>
          </section>
        )}

        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sorted.map((b) => {
            const rank = rankFor(b, access)
            const owners = ownerCounts.get(b.id) ?? 0
            const mappings = mappingCounts.get(b.id) ?? 0
            const faded = !b.active
            return (
              <Link
                key={b.id}
                href={`/otter/businesses/${b.slug}`}
                className={[
                  'group rounded-2xl border bg-bg-card hover:bg-bg-card2 transition',
                  'border-line p-5 flex flex-col gap-3',
                  faded ? 'opacity-50 hover:opacity-75' : '',
                ].join(' ')}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex flex-col gap-1 min-w-0">
                    <div className="font-semibold text-lg truncate group-hover:text-accent">
                      {b.name}
                    </div>
                    <div className="font-mono text-xs text-ink-dim truncate">
                      {b.slug}
                    </div>
                  </div>
                  <span
                    className={[
                      'inline-flex items-center rounded-full border px-2 py-0.5 text-xs whitespace-nowrap',
                      providerColor(b.providerType),
                    ].join(' ')}
                  >
                    {b.providerType}
                  </span>
                </div>

                <div className="flex items-center gap-4 text-xs text-ink-dim">
                  <span>
                    <span className="text-ink font-medium">{owners}</span> owner{owners === 1 ? '' : 's'}
                  </span>
                  <span>
                    <span className="text-ink font-medium">{mappings}</span> role mapping{mappings === 1 ? '' : 's'}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-2 pt-1 mt-auto">
                  {rank ? (
                    <span
                      className={[
                        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs',
                        rankColor(rank),
                      ].join(' ')}
                    >
                      {rankLabel(rank)}
                    </span>
                  ) : (
                    <span />
                  )}
                  {!b.active && (
                    <span className="inline-flex items-center rounded-full border border-err/30 bg-err/10 px-2 py-0.5 text-xs text-err">
                      Deactivated
                    </span>
                  )}
                </div>
              </Link>
            )
          })}
        </section>
      </div>
    </main>
  )
}

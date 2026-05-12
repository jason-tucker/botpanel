/**
 * Wave 7c-B — shared helpers for the four employee write routes.
 *
 * The hire/fire/promote/demote routes all do the same first three steps:
 *   1. Read + validate `userId` (+ verb-specific fields) from the JSON body.
 *   2. Look up the business by slug.
 *   3. Check the actor's rank in `access.otter.businesses[slug]` against the
 *      verb-specific permission rules.
 *
 * Extracting that here keeps each route file focused on its before/after
 * audit shape rather than re-implementing the same plumbing four times.
 */
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { type NextRequest } from 'next/server'
import { otterDb } from '@/lib/db/otter'
import { businesses } from '@/lib/db/schema/otter/businesses'
import { businessOwners } from '@/lib/db/schema/otter/businessOwners'
import type { BusinessRank } from '@/lib/auth/perms'

export const SNOWFLAKE_RE = /^\d{15,25}$/

export const baseBodySchema = z.object({
  userId: z
    .string()
    .trim()
    .regex(SNOWFLAKE_RE, 'userId must be a Discord snowflake (15-25 digits)'),
})

export async function readJsonBody(req: NextRequest): Promise<unknown> {
  // Mirror the multi-format reader used by the other otter routes — accept
  // JSON or form-encoded so `<ServerForm>`'s default behaviour works either
  // way without callers having to set `_format=json`.
  const ct = req.headers.get('content-type') ?? ''
  if (ct.includes('application/json')) return req.json()
  if (
    ct.includes('application/x-www-form-urlencoded') ||
    ct.includes('multipart/form-data')
  ) {
    const fd = await req.formData()
    const obj: Record<string, unknown> = {}
    for (const [k, v] of fd.entries()) {
      if (k === '_csrf' || k === '_format') continue
      obj[k] = typeof v === 'string' ? v : ''
    }
    return obj
  }
  return req.json()
}

/**
 * Resolve `slug` → `businessId`. Returns null on miss so the caller can
 * audit-log the 404 with the right action name.
 */
export async function resolveBusinessId(slug: string): Promise<string | null> {
  try {
    const rows = await otterDb
      .select({ id: businesses.id })
      .from(businesses)
      .where(eq(businesses.slug, slug))
      .limit(1)
    return rows[0]?.id ?? null
  } catch (err) {
    console.warn('[employees/_lib] business lookup failed', err)
    return null
  }
}

/**
 * True if `userId` has an explicit `business_owners` row for `businessId`.
 * Used by `fire` to enforce "cannot fire owner via panel" and by `promote`
 * + `demote` for completeness when surfacing target rank.
 */
export async function isDbOwner(businessId: string, userId: string): Promise<boolean> {
  try {
    const rows = await otterDb
      .select({ id: businessOwners.id })
      .from(businessOwners)
      .where(
        and(
          eq(businessOwners.businessId, businessId),
          eq(businessOwners.discordUserId, userId),
        ),
      )
      .limit(1)
    return rows.length > 0
  } catch (err) {
    console.warn('[employees/_lib] isDbOwner check failed', err)
    return false
  }
}

/**
 * Manager-or-owner check on the panel side. Bot owner is always allowed —
 * mirrors every other otter route that gates on a business rank.
 */
export function canManage(rank: BusinessRank | undefined, isBotOwner: boolean): boolean {
  if (isBotOwner) return true
  return rank === 'owner' || rank === 'manager'
}

/** Owner-only — for `hire owner`. */
export function canActAsOwner(rank: BusinessRank | undefined, isBotOwner: boolean): boolean {
  if (isBotOwner) return true
  return rank === 'owner'
}

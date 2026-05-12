/**
 * Shared helpers for the `/api/squishy/voice/[id]/*` routes.
 *
 * These routes all share the same gating logic: load the `auto_channels`
 * row by `voiceChannelId`, then verify the viewer is the owner, a host,
 * the acting owner (during a grace window), squishy sudo, or bot owner.
 * That last bit mirrors the bot's `canControlChannel(member, record)` in
 * `services/voice/permissions.ts` — we can't reuse that function directly
 * because we don't have a discord.js GuildMember here, just the AccessMap
 * + the DB row.
 */
import { eq } from 'drizzle-orm'
import { squishyDb, squishySchema } from '@/lib/db/squishy'
import type { AccessMap } from '@/lib/auth/perms'

export type AutoChannelRow = typeof squishySchema.autoChannels.$inferSelect

const SNOWFLAKE_RE = /^\d{15,25}$/

export function isSnowflake(v: string): boolean {
  return SNOWFLAKE_RE.test(v)
}

export async function loadAutoChannel(
  voiceChannelId: string,
): Promise<AutoChannelRow | null> {
  const rows = await squishyDb
    .select()
    .from(squishySchema.autoChannels)
    .where(eq(squishySchema.autoChannels.voiceChannelId, voiceChannelId))
    .limit(1)
  return rows[0] ?? null
}

/**
 * True when the viewing user (i.e. `access.viewing.id`) is allowed to
 * mutate the given auto-channel. Mirrors the bot's `canControlChannel`:
 *  - bot owner: always
 *  - squishy sudo: always
 *  - owner: always
 *  - host: always
 *  - acting owner (only valid during an active grace window): allowed
 *
 * The acting-owner branch deliberately accepts a stale `actingOwnerUserId`
 * with an expired grace timestamp the same way the bot does — the bot's
 * own implementation in `permissions.ts` just checks the column without
 * cross-referencing the expiry (the grace expiry promotes the acting
 * owner in-place, clearing the column when the promotion runs). Reading
 * the column in isolation matches that behaviour.
 */
export function canControlChannel(
  access: AccessMap,
  record: AutoChannelRow,
): boolean {
  if (access.botOwner) return true
  if (access.squishy.sudo) return true
  const viewerId = access.viewing.id
  if (viewerId === record.ownerUserId) return true
  if (record.hostUserIds.includes(viewerId)) return true
  if (record.actingOwnerUserId === viewerId) return true
  return false
}

/**
 * Owner-or-sudo gate — stricter than `canControlChannel`. Used by the
 * destructive verbs (delete, transfer) where the bot also restricts to
 * owner-or-sudo (see `requireOwnerOrSudo` in
 * `interactions/buttons/voiceControl.ts`).
 */
export function canDestructivelyControlChannel(
  access: AccessMap,
  record: AutoChannelRow,
): boolean {
  if (access.botOwner) return true
  if (access.squishy.sudo) return true
  return access.viewing.id === record.ownerUserId
}

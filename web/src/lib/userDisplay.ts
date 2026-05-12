/**
 * Snowflake → @username + avatar resolution for panel display surfaces.
 *
 * Both bots expose a `users.resolve` RPC verb that batch-looks up
 * `[{id, username, displayName, avatarUrl}]` from their `client.users.cache`
 * + `guild.members.cache`. This helper wraps that into something page
 * components can call once during server render, falling back gracefully to
 * the raw snowflake if the bot is unreachable or the user isn't cached.
 *
 * Caching: results live in a module-level Map keyed by `${bot}:${userId}`
 * with a 5-minute TTL. Server renders within the same compose-up
 * (especially polling pages like /squishy/voice that re-render every few
 * seconds) get a hit-rate close to 100% after the first lookup, so audit
 * tables stay snappy and the bot doesn't get pelted with redundant
 * `users.resolve` calls every render. The cache is per-process — the panel
 * runs a single Next server today, so a Map is enough; we can swap to
 * Redis later if we ever scale out.
 *
 * On RPC failure we return an empty Map; callers should fall back to
 * rendering the raw id.
 */
import { callBot, type BotName } from './botrpc'

export type ResolvedUser = {
  username: string
  displayName: string
  avatarUrl: string
}

const TTL_MS = 5 * 60 * 1000

type CacheEntry = {
  value: ResolvedUser | null
  expiresAt: number
}

const cache = new Map<string, CacheEntry>()

function cacheKey(bot: BotName, userId: string): string {
  return `${bot}:${userId}`
}

function getCached(bot: BotName, userId: string): { hit: true; value: ResolvedUser | null } | { hit: false } {
  const e = cache.get(cacheKey(bot, userId))
  if (!e) return { hit: false }
  if (e.expiresAt < Date.now()) {
    cache.delete(cacheKey(bot, userId))
    return { hit: false }
  }
  return { hit: true, value: e.value }
}

function setCached(bot: BotName, userId: string, value: ResolvedUser | null): void {
  cache.set(cacheKey(bot, userId), { value, expiresAt: Date.now() + TTL_MS })
}

type ResolveReply = {
  users: Array<{
    id: string
    username: string | null
    displayName: string | null
    avatarUrl: string | null
  }>
}

/**
 * Batch-resolve a set of Discord user ids into display chips.
 *
 * - Duplicates in `userIds` are coalesced before the RPC call.
 * - Cached entries are returned without touching the bot.
 * - RPC failure / `null` reply fields cause those ids to be absent from
 *   the returned Map so the caller can render the raw snowflake.
 */
export async function resolveUsernames(
  bot: BotName,
  userIds: string[],
): Promise<Map<string, ResolvedUser>> {
  const out = new Map<string, ResolvedUser>()
  if (userIds.length === 0) return out

  // Walk the request: serve cache hits inline, collect misses for the
  // single RPC batch below. The miss list is dedup'd because the same id
  // can appear multiple times in caller-supplied input (audit tables join
  // actor + viewing, voice lists join owner + hosts + members, etc.).
  const misses = new Set<string>()
  for (const id of userIds) {
    const c = getCached(bot, id)
    if (c.hit) {
      if (c.value) out.set(id, c.value)
      continue
    }
    misses.add(id)
  }

  if (misses.size === 0) return out

  // The bot caps per-call payload at 100 ids. Split into chunks rather
  // than rejecting — large audit pages can easily reference hundreds of
  // distinct actors over time.
  const missArr = Array.from(misses)
  const CHUNK = 100
  for (let i = 0; i < missArr.length; i += CHUNK) {
    const chunk = missArr.slice(i, i + CHUNK)
    const reply = await callBot<ResolveReply>(bot, 'users.resolve', { userIds: chunk })
    if (!reply.ok) {
      // RPC down / timeout. Don't cache absence — a retry next render
      // might succeed (e.g. the bot was briefly restarting). Callers
      // fall back to the raw id for these.
      continue
    }
    const users = reply.data?.users ?? []
    // Index the reply by id so we can detect ids the bot didn't return
    // (shouldn't happen — handler always returns one row per requested
    // id — but defensive).
    const byId = new Map<string, ResolveReply['users'][number]>()
    for (const u of users) byId.set(u.id, u)
    for (const id of chunk) {
      const row = byId.get(id)
      if (row && row.username && row.displayName && row.avatarUrl) {
        const v: ResolvedUser = {
          username: row.username,
          displayName: row.displayName,
          avatarUrl: row.avatarUrl,
        }
        out.set(id, v)
        setCached(bot, id, v)
      } else {
        // Bot doesn't have this user cached — remember that for 5 min so
        // we don't ping the bot every render for a known-unknown.
        setCached(bot, id, null)
      }
    }
  }

  return out
}

/**
 * Single-id wrapper for the per-bot `/api/{bot}/users/[id]` routes.
 *
 * Returns null when the bot doesn't have the user cached OR the RPC failed
 * — callers should render the raw snowflake in either case.
 */
export async function resolveOneUsername(
  bot: BotName,
  userId: string,
): Promise<ResolvedUser | null> {
  const map = await resolveUsernames(bot, [userId])
  return map.get(userId) ?? null
}

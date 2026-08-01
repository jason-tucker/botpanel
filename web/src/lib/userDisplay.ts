/**
 * Snowflake → @username + avatar resolution for panel display surfaces.
 *
 * Both bots expose a `users.resolve` RPC verb that batch-looks up
 * `[{id, username, displayName, avatarUrl}]` from their `client.users.cache`
 * + `guild.members.cache`. This helper wraps that into something page
 * components can call once during server render, falling back gracefully to
 * the raw snowflake if the bot is unreachable or the user isn't cached.
 *
 * Caching: results live in a module-level Map keyed by `${bot}:${userId}`,
 * fresh for 5 minutes and then served STALE-while-revalidating for up to
 * 30 minutes — a page render never waits on the bot for a name it has seen
 * within the last half hour; the refresh happens in the background after
 * the response is sent. The cache is per-process — the panel runs a single
 * Next server today, so a Map is enough; we can swap to Redis later if we
 * ever scale out.
 *
 * Latency budget: display names are decoration, not data — the RPC wait is
 * capped at RESOLVE_TIMEOUT_MS (well under callBot's 5s default) so a
 * down/busy bot degrades pages to raw snowflakes instead of freezing every
 * navigation for the full RPC timeout.
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

const FRESH_MS = 5 * 60 * 1000
const STALE_MS = 30 * 60 * 1000
const RESOLVE_TIMEOUT_MS = 1500

type CacheEntry = {
  value: ResolvedUser | null
  /** After this: serve stale + refresh in background. */
  freshUntil: number
  /** After this: treat as a miss (blocking refetch). */
  staleUntil: number
}

const cache = new Map<string, CacheEntry>()

function cacheKey(bot: BotName, userId: string): string {
  return `${bot}:${userId}`
}

function getCached(
  bot: BotName,
  userId: string,
): { hit: true; value: ResolvedUser | null; stale: boolean } | { hit: false } {
  const e = cache.get(cacheKey(bot, userId))
  if (!e) return { hit: false }
  const now = Date.now()
  if (e.staleUntil < now) {
    cache.delete(cacheKey(bot, userId))
    return { hit: false }
  }
  return { hit: true, value: e.value, stale: e.freshUntil < now }
}

function setCached(bot: BotName, userId: string, value: ResolvedUser | null): void {
  const now = Date.now()
  cache.set(cacheKey(bot, userId), { value, freshUntil: now + FRESH_MS, staleUntil: now + STALE_MS })
}

// One in-flight background refresh per bot at a time — enough to keep the
// cache warm without stampeding the bot when many stale ids co-occur.
const refreshing = new Set<BotName>()

function refreshInBackground(bot: BotName, userIds: string[]): void {
  if (userIds.length === 0 || refreshing.has(bot)) return
  refreshing.add(bot)
  void fetchAndCache(bot, userIds)
    .catch(() => {})
    .finally(() => refreshing.delete(bot))
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

  // Walk the request: serve cache hits inline (fresh OR stale — stale ids
  // are refreshed in the background so the render never waits), collect
  // true misses for the blocking RPC batch below. The miss list is dedup'd
  // because the same id can appear multiple times in caller-supplied input
  // (audit tables join actor + viewing, voice lists join owner + hosts +
  // members, etc.).
  const misses = new Set<string>()
  const staleIds: string[] = []
  for (const id of userIds) {
    const c = getCached(bot, id)
    if (c.hit) {
      if (c.value) out.set(id, c.value)
      if (c.stale) staleIds.push(id)
      continue
    }
    misses.add(id)
  }
  refreshInBackground(bot, staleIds)

  if (misses.size === 0) return out

  const fetched = await fetchAndCache(bot, Array.from(misses))
  for (const [id, v] of fetched) out.set(id, v)
  return out
}

/** Blocking fetch for the given ids; writes results into the cache and
 * returns whatever resolved. Shared by the render path (misses) and the
 * background stale-refresh. */
async function fetchAndCache(bot: BotName, ids: string[]): Promise<Map<string, ResolvedUser>> {
  const out = new Map<string, ResolvedUser>()
  // The bot caps per-call payload at 100 ids. Split into chunks rather
  // than rejecting — large audit pages can easily reference hundreds of
  // distinct actors over time. Chunks are independent requests, so fire
  // them in parallel: on a cold cache a 300-user page costs one RPC
  // round-trip instead of three back-to-back (and worst-case timeouts
  // overlap instead of stacking).
  const CHUNK = 100
  const chunks: string[][] = []
  for (let i = 0; i < ids.length; i += CHUNK) {
    chunks.push(ids.slice(i, i + CHUNK))
  }
  const replies = await Promise.all(
    chunks.map((chunk) =>
      callBot<ResolveReply>(bot, 'users.resolve', { userIds: chunk }, { timeoutMs: RESOLVE_TIMEOUT_MS }),
    ),
  )
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]
    const reply = replies[i]
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
        // Bot doesn't have this user cached — remember that so we don't
        // ping the bot every render for a known-unknown.
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

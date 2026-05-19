/**
 * `publishInvalidate(bot, params)` — fire-and-forget Redis pubsub telling a
 * bot to drop its in-memory cache for a settings/catalog row the panel
 * just mutated.
 *
 * Why this exists: bots cache `bot_settings`, `games`, `hub_channels`,
 * `auto_thread_channels`, `social_feeds`, etc. at boot. Without this event,
 * a panel write was correct in the DB but invisible to the bot until its
 * next restart. (Tracking: #33 / V3-1.)
 *
 * Channel format: `bot.<botname>.settings.invalidate` — matches the
 * existing `bot.*.*.*` pattern bot processes already psubscribe to in
 * `eventBus.ts`. Bot side adds a handler that, on receipt, calls the
 * relevant `loadXxx()` / `cache.invalidate()`.
 *
 * Envelope: same HMAC shape as `botrpc.ts` so the bot can verify the
 * publisher with the shared `BOTPANEL_RPC_SECRET` before acting.
 *
 * Posture:
 *  - Fire-and-forget. Returns void. Errors log-only — a Redis hiccup
 *    must NEVER fail the underlying panel write that just succeeded.
 *  - Own lazy publisher singleton so we don't entangle with `botrpc.ts`'s
 *    internals (its singleton is module-private).
 *  - No reply. The bot is expected to invalidate eagerly; if it misses
 *    the event (down, network blip, HMAC mismatch), its next restart
 *    rebuilds the cache from authoritative tables anyway.
 */
import Redis, { type RedisOptions } from 'ioredis'
import { createHmac } from 'node:crypto'
import { env } from '../env'

export type BotName = 'squishy' | 'otter'

export interface InvalidateParams {
  /** Table the row lives in (`bot_settings`, `games`, `hub_channels`, …). */
  table: string
  /** Optional row key for surgical invalidation (e.g. `staff.role.tier_1`). */
  key?: string
}

let publisher: Redis | null = null

function getPublisher(): Redis {
  if (publisher) return publisher
  const opts: RedisOptions = {
    lazyConnect: true,
    retryStrategy: (times) => Math.min(times * 500, 10_000),
    enableOfflineQueue: true,
    maxRetriesPerRequest: 50,
  }
  const r = new Redis(env.REDIS_URL, opts)
  r.on('error', (err: Error) => {
    console.warn(`invalidate: publisher error: ${err.message}`)
  })
  r.connect().catch(() => {})
  publisher = r
  return r
}

function channelFor(bot: BotName): string {
  return `bot.${bot}.settings.invalidate`
}

function envelope(channel: string, params: InvalidateParams): string {
  const ts = Date.now()
  const payload = JSON.stringify(params)
  const mac = createHmac('sha256', env.BOTPANEL_RPC_SECRET ?? '')
    .update(`${channel}|${ts}|${payload}`)
    .digest('hex')
  return JSON.stringify({ ts, hmac: mac, params })
}

export function publishInvalidate(bot: BotName, params: InvalidateParams): void {
  if (!env.BOTPANEL_RPC_SECRET) {
    // Same posture as botrpc: if the env's unset, panel writes still work,
    // we just don't notify. The bot will pick up the change on next restart.
    return
  }
  const channel = channelFor(bot)
  let body: string
  try {
    body = envelope(channel, params)
  } catch (err) {
    console.warn(`invalidate: envelope failed for ${bot}/${params.table}:`, err)
    return
  }
  void getPublisher()
    .publish(channel, body)
    .catch((err: Error) => {
      console.warn(`invalidate: publish failed channel=${channel}: ${err.message}`)
    })
}

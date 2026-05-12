/**
 * Redis subscriber — lazy singleton for the Next.js process.
 *
 * One subscriber per process. We keep this separate from any future publisher
 * because ioredis puts a subscribed client into "subscriber mode" — that
 * client can no longer issue normal commands.
 *
 * Resilience rules mirror the bot-side `eventBus.ts`:
 *  - `lazyConnect: true`           — module import never blocks on Redis being up.
 *  - `enableOfflineQueue: false`   — Next.js is the consumer here, not the
 *                                    publisher, so queuing commands during an
 *                                    outage just leaks memory and bursts on
 *                                    reconnect. Drop on the floor instead.
 *  - capped exponential retry      — keep trying forever but cap the delay so
 *                                    we don't burn CPU when Redis is gone.
 *  - `.on('error', ...)` log-only  — Redis being down must NEVER crash the
 *                                    Next.js process; the /api/healthz route
 *                                    just returns `bots: {}` until Redis is
 *                                    back and a heartbeat lands.
 */
import Redis, { type RedisOptions } from 'ioredis'
import { env } from './env'

let subscriber: Redis | null = null
let warnedDown = false

export function getSubscriber(): Redis {
  if (subscriber) return subscriber

  const opts: RedisOptions = {
    lazyConnect: true,
    // Cap retry delay at 10s; ioredis multiplies by attempt count.
    retryStrategy: (times) => Math.min(times * 500, 10_000),
    // Subscriber needs offline-queue ON so the initial psubscribe queues
    // until the connection is ready (lazyConnect means it's not ready
    // at module load). The queue is bounded to subscriber commands only
    // and fires once on 'ready' — no memory leak risk.
    enableOfflineQueue: true,
    // maxRetriesPerRequest is incompatible with subscriber mode (you
    // can't issue regular commands after psubscribe, so retrying them
    // means nothing). Leave at default (null = retry indefinitely).
  }

  const r = new Redis(env.REDIS_URL, opts)

  r.on('connect', () => {
    if (warnedDown) {
      console.warn(`redis: subscriber reconnected to ${env.REDIS_URL}`)
      warnedDown = false
    }
  })
  r.on('error', (err: Error) => {
    // Demote repeat errors to one-shot warn so a downed Redis doesn't spam
    // every retry attempt. Re-arms on successful reconnect above.
    if (!warnedDown) {
      console.warn(`redis: subscriber error: ${err.message}`)
      warnedDown = true
    }
  })
  r.on('end', () => {
    if (!warnedDown) {
      console.warn('redis: subscriber connection ended')
      warnedDown = true
    }
  })

  // Kick off the initial connect in the background. Failures land on 'error';
  // they never bubble up to the import-time caller.
  r.connect().catch(() => {})

  subscriber = r
  return r
}

/**
 * Panel-side command-bus client — `callBot(bot, verb, params, opts?)`.
 *
 * Round-trip pattern:
 *  1. Generate a fresh `requestId` (24 random bytes, hex-encoded).
 *  2. Subscribe to `res.<requestId>` on a NEW ioredis client BEFORE
 *     publishing — otherwise the reply could land before we're listening
 *     and we'd wait the full timeout for nothing.
 *  3. Publish the request on `cmd.<bot>.<verb>` over a separate publisher
 *     client (also lazy-singleton'd: the existing `lib/redis.ts` subscriber
 *     is in subscriber mode and can't `PUBLISH`).
 *  4. Resolve on the first message OR a 5s default timeout. Either way the
 *     per-call subscriber is disconnected before we return — TCP setup
 *     overhead per write op is fine (write ops are rare).
 *
 * Envelope:
 *   ```json
 *   {
 *     "requestId": "<48 hex chars>",
 *     "ts": 1731436800000,
 *     "hmac": "<hex sha256>",
 *     "params": <caller value>
 *   }
 *   ```
 *  `hmac = HMAC-SHA256(BOTPANEL_RPC_SECRET, `${channel}|${requestId}|${ts}|${JSON.stringify(params)}`)`.
 *  Bot side recomputes; on mismatch it drops silently → our caller times
 *  out with `{ok:false, error:'timeout'}`. That's the correct posture
 *  because a "bad HMAC" reply is itself an oracle.
 *
 * Failure modes the caller sees:
 *  - `{ ok: false, error: 'rpc-not-configured' }` — `BOTPANEL_RPC_SECRET`
 *    unset. We don't throw here so the calling route can render a friendly
 *    error card instead of 500-ing.
 *  - `{ ok: false, error: 'timeout' }` — no reply within `opts.timeoutMs`
 *    (default 5000). Includes HMAC-rejected requests since the bot drops
 *    them silently.
 *  - `{ ok: false, error: 'redis-down' }` — publisher couldn't connect at
 *    all (the lazy connection failed AND offline-queue is off). Rare;
 *    usually we still queue and the request goes out on reconnect.
 *  - `{ ok: false, error: 'bad-reply' }` — reply JSON failed to parse OR
 *    didn't match the `{ok, ...}` envelope shape.
 *  - `{ ok: true, data }` / `{ ok: false, error, details? }` — pass-through
 *    of the bot's reply.
 *
 * Why a fresh subscriber per call rather than multiplexing on the existing
 * singleton: multiplexing requires owning a request→resolver Map keyed by
 * `requestId`, with timeout cleanup, and surviving reconnects that drop
 * the subscription. The per-call subscriber pays one TCP handshake (~ms
 * on localhost / containers) and has zero shared-state hazards. Wave 7's
 * write surfaces are user-initiated and rare enough that the simpler shape
 * is the right call. Multiplexing is an easy upgrade later if profiling
 * says so.
 */
import Redis, { type RedisOptions } from 'ioredis'
import { randomBytes } from 'node:crypto'
import { env } from './env'
import { hmacSha256 } from './util/hmac'

export type BotName = 'squishy' | 'otter'

export type BotRpcResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string; details?: unknown }

export interface BotRpcOptions {
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 5000

// ─── Publisher singleton ────────────────────────────────────────────
// Separate from `lib/redis.ts` because that client is in subscriber
// mode and can't issue regular commands. Lazy: first PUBLISH triggers
// the connect. Offline queue ON so a publish during an outage is
// buffered and flushed on reconnect (we still time out on the reply
// path if the request never actually goes out, so this can't wedge).
let publisher: Redis | null = null

function getPublisher(): Redis {
  if (publisher) return publisher
  const opts: RedisOptions = {
    lazyConnect: true,
    retryStrategy: (times) => Math.min(times * 500, 10_000),
    enableOfflineQueue: true,
    // maxRetriesPerRequest defaults to 20; bump higher so a brief
    // blip during publish doesn't synthesize an error before the
    // reply timeout has a chance to fire.
    maxRetriesPerRequest: 50,
  }
  const r = new Redis(env.REDIS_URL, opts)
  r.on('error', (err: Error) => {
    // Log-only; same posture as lib/redis.ts. The reply timeout is
    // the user-visible error path — Redis warnings shouldn't crash
    // the Next process.
    console.warn(`botrpc: publisher error: ${err.message}`)
  })
  r.connect().catch(() => {})
  publisher = r
  return r
}

// ─── Per-call reply subscriber ──────────────────────────────────────
// Fresh client per call. Disconnects on first message or timeout.
function makeReplySubscriber(): Redis {
  const opts: RedisOptions = {
    lazyConnect: true,
    // Don't retry forever — if Redis is down at call time, fail the
    // call rather than queueing the SUBSCRIBE forever (the publisher
    // singleton is separate and has its own retry policy).
    retryStrategy: (times) => (times > 3 ? null : 500),
    enableOfflineQueue: true,
  }
  return new Redis(env.REDIS_URL, opts)
}

function isReplyShape(v: unknown): v is BotRpcResult {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  if (o.ok === true) return true
  if (o.ok === false && typeof o.error === 'string') return true
  return false
}

/**
 * Issue a command-bus call to the named bot and await its reply.
 *
 * Examples:
 *   const r = await callBot<{pong: number}>('squishy', 'echo', { message: 'hi' })
 *   const r = await callBot('otter', 'business.sync', { slug: 'oc' }, { timeoutMs: 10_000 })
 */
export async function callBot<T = unknown>(
  bot: BotName,
  verb: string,
  params: unknown,
  opts?: BotRpcOptions,
): Promise<BotRpcResult<T>> {
  if (!env.BOTPANEL_RPC_SECRET) {
    return { ok: false, error: 'rpc-not-configured' }
  }

  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const requestId = randomBytes(24).toString('hex')
  const ts = Date.now()
  const channel = `cmd.${bot}.${verb}`
  const replyChannel = `res.${requestId}`
  const paramsJson = JSON.stringify(params ?? null)
  const hmac = hmacSha256(
    env.BOTPANEL_RPC_SECRET,
    `${channel}|${requestId}|${ts}|${paramsJson}`,
  )

  // Step 1: build the reply subscriber and SUBSCRIBE before the publish.
  const sub = makeReplySubscriber()

  // Always disconnect the per-call subscriber — wrapped so a throw or
  // an early-return path can't leak the connection.
  let disconnected = false
  const disconnect = (): void => {
    if (disconnected) return
    disconnected = true
    // .disconnect() is sync and tears down the socket. .quit() would be
    // graceful (sends QUIT, waits) but we don't need that on a one-shot
    // client and it adds latency to the user-visible return.
    try {
      sub.disconnect()
    } catch {
      // Already torn down — fine.
    }
  }

  try {
    return await new Promise<BotRpcResult<T>>((resolve) => {
      let settled = false
      const settle = (r: BotRpcResult<T>): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        disconnect()
        resolve(r)
      }

      const timer = setTimeout(() => {
        settle({ ok: false, error: 'timeout' })
      }, timeoutMs)

      sub.on('message', (ch: string, message: string) => {
        if (ch !== replyChannel) return
        let parsed: unknown
        try {
          parsed = JSON.parse(message)
        } catch {
          settle({ ok: false, error: 'bad-reply' })
          return
        }
        if (!isReplyShape(parsed)) {
          settle({ ok: false, error: 'bad-reply', details: parsed })
          return
        }
        settle(parsed as BotRpcResult<T>)
      })

      sub.on('error', (err: Error) => {
        // Don't settle on every error event — ioredis emits these on
        // every retry attempt while the connection is being established.
        // The timeout is the user-visible error path. We just log so an
        // operator can pull container logs and see what happened.
        console.warn(`botrpc: reply subscriber error (${requestId}): ${err.message}`)
      })

      // Connect → SUBSCRIBE → publish, in that order. If any step fails,
      // the timeout will catch it; we don't synthesize a faster failure
      // because the partial-state branch logic gets ugly fast (e.g. the
      // publish goes out but the subscribe failed → we'd race the bot's
      // reply with our own teardown).
      sub
        .connect()
        .then(() => sub.subscribe(replyChannel))
        .then(() => {
          const envelope = JSON.stringify({ requestId, ts, hmac, params })
          return getPublisher().publish(channel, envelope)
        })
        .catch((err: Error) => {
          // Publisher offline-queue would normally absorb this, but if
          // we got here, the SUBSCRIBE itself probably failed — the
          // call can never succeed, so fail fast instead of waiting
          // the full timeout.
          console.warn(`botrpc: setup failed (${requestId}): ${err.message}`)
          settle({ ok: false, error: 'redis-down', details: err.message })
        })
    })
  } finally {
    // Defensive — the resolved-path also calls this, but if anything
    // in the Promise constructor throws synchronously before settle()
    // attaches the disconnect, we still won't leak the socket.
    disconnect()
  }
}

/**
 * Bot heartbeat aggregator — subscribes to `bot.*.bot.heartbeat` on Redis and
 * keeps the last-seen payload per bot in a module-level Map.
 *
 * The bot-side `eventBus.ts` in each bot's repo publishes a heartbeat every
 * 60s on `bot.<name>.bot.heartbeat` with payload `{ version, uptime, ts }`
 * (otterbot also adds `guildCount`). We psubscribe once at module load and
 * extract `<name>` from the channel pattern.
 *
 * Staleness: if we haven't seen a beat in 3× the publish interval (180s),
 * `getHeartbeats()` omits that bot so the landing page falls back to its
 * "no heartbeat yet" state — better than showing a stale uptime as if it
 * were live.
 *
 * Resilience: if Redis is unreachable at boot, `getSubscriber()` still
 * returns a Redis instance that will retry in the background. The Map stays
 * empty, `getHeartbeats()` returns `{}`, and /api/healthz responds normally.
 */
import { getSubscriber } from './redis'

const HEARTBEAT_TICK_MS = 60_000
const STALE_AFTER_MS = HEARTBEAT_TICK_MS * 3 // 180s — 3 missed beats
const PATTERN = 'bot.*.bot.heartbeat'

type BotName = 'squishy' | 'otter'

interface HeartbeatPayload {
  version?: string
  uptime?: number
  ts?: string
  guildCount?: number
  // Anything else the bots tack on — keep it for forward-compat.
  [key: string]: unknown
}

interface HeartbeatEntry {
  lastSeen: number
  payload: HeartbeatPayload
}

const heartbeats = new Map<BotName, HeartbeatEntry>()

let subscribed = false

function ensureSubscribed(): void {
  if (subscribed) return
  subscribed = true

  const sub = getSubscriber()

  // pmessage fires for every message matching a pattern, with the actual
  // channel as `channel` and the matched pattern as `pattern`.
  sub.on('pmessage', (_pattern: string, channel: string, message: string) => {
    // Channel format: bot.<name>.bot.heartbeat
    const parts = channel.split('.')
    if (parts.length !== 4 || parts[0] !== 'bot' || parts[2] !== 'bot' || parts[3] !== 'heartbeat') {
      return
    }
    const name = parts[1]
    if (name !== 'squishy' && name !== 'otter') return

    let payload: HeartbeatPayload
    try {
      payload = JSON.parse(message) as HeartbeatPayload
    } catch {
      // Bad publisher; skip rather than crash the subscriber.
      return
    }

    heartbeats.set(name, { lastSeen: Date.now(), payload })
  })

  // psubscribe is async but we deliberately fire-and-forget — failure here
  // means Redis is down, and `getSubscriber()` will retry the connection
  // and re-emit our handlers on reconnect... except ioredis does NOT
  // auto-resubscribe by default, so we re-subscribe on every 'connect'.
  const resubscribe = () => {
    sub.psubscribe(PATTERN).catch((err: Error) => {
      console.warn(`heartbeats: psubscribe failed: ${err.message}`)
    })
  }
  sub.on('connect', resubscribe)
  // If we're already connected (e.g. hot-reload in dev), kick it now too.
  resubscribe()
}

// Side-effect import: kick off the subscription at module load.
ensureSubscribed()

/**
 * Snapshot of currently-live bot heartbeats. Stale entries (no beat in
 * `STALE_AFTER_MS`) are omitted entirely — the landing page treats a missing
 * key as "no heartbeat yet".
 *
 * Each entry exposes both the spec shape (`lastSeen` as ISO, `uptime`,
 * `version`, optional `guildCount`) AND the landing-script convenience
 * fields (`online: true`, `lastBeatSec`) so the UI in `landing/script.js`
 * can render green dots with last-beat ages without re-deriving them.
 */
export function getHeartbeats(): Record<string, Record<string, unknown>> {
  const now = Date.now()
  const out: Record<string, Record<string, unknown>> = {}

  for (const [name, entry] of heartbeats) {
    const age = now - entry.lastSeen
    if (age > STALE_AFTER_MS) continue

    const row: Record<string, unknown> = {
      lastSeen: new Date(entry.lastSeen).toISOString(),
      online: true,
      lastBeatSec: Math.round(age / 1000),
    }
    if (typeof entry.payload.uptime === 'number') row.uptime = entry.payload.uptime
    if (typeof entry.payload.version === 'string') row.version = entry.payload.version
    if (typeof entry.payload.guildCount === 'number') row.guildCount = entry.payload.guildCount

    out[name] = row
  }

  return out
}

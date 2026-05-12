/**
 * GET /api/audit/stream — Server-Sent Events live tail of both audit streams.
 *
 * Psubscribes to the two bot-side event channels and emits each incoming
 * message as a `data: <json>\n\n` SSE frame in the same `UnifiedEntry` shape
 * used by `/api/audit/list` so the client can append rows uniformly:
 *
 *   - `bot.squishy.settings.setting_changed` → `{ key, oldValue, newValue, by, ts }`
 *   - `bot.otter.audit.written`              → `{ actorDiscordId, businessId, action,
 *                                                  targetType, targetId, success, details, ts }`
 *
 * The redis subscriber is the shared lazy singleton from `lib/redis.ts`, so
 * we DO NOT call `psubscribe` for channels someone else might already be
 * holding — we attach our own `pmessage` handler and filter by pattern, and
 * we cleanup that handler (NOT the subscription itself) on disconnect.
 *
 * A 30s heartbeat comment (`:keep-alive`) keeps proxies from closing the
 * connection on idle. On client disconnect (AbortSignal) we tear down the
 * stream gracefully.
 *
 * Runtime is `nodejs` (not edge) because ioredis requires the Node net stack.
 */
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/middleware'
import { getSubscriber } from '@/lib/redis'
import type { UnifiedEntry } from '../list/route'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SQUISHY_CHANNEL = 'bot.squishy.settings.setting_changed'
const OTTER_CHANNEL = 'bot.otter.audit.written'
const HEARTBEAT_MS = 30_000

function squishySummary(p: {
  key: unknown
  oldValue: unknown
  newValue: unknown
}): string {
  const fmt = (v: unknown): string => {
    if (v == null) return '∅'
    const s = typeof v === 'string' ? v : JSON.stringify(v)
    return s.length > 80 ? `${s.slice(0, 80)}…` : s
  }
  return `key=${String(p.key ?? '?')}  old=${fmt(p.oldValue)}  new=${fmt(p.newValue)}`
}

function otterSummary(p: {
  businessId?: unknown
  targetType?: unknown
  targetId?: unknown
  success?: unknown
}): string {
  const parts: string[] = []
  if (p.businessId) parts.push(`biz=${String(p.businessId)}`)
  if (p.targetType || p.targetId) {
    parts.push(`target=${String(p.targetType ?? '?')}/${String(p.targetId ?? '?')}`)
  }
  parts.push(`success=${p.success === false ? 'false' : 'true'}`)
  return parts.join('  ')
}

function normalize(channel: string, message: string): UnifiedEntry | null {
  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(message) as Record<string, unknown>
  } catch {
    return null
  }

  const ts =
    typeof payload.ts === 'string'
      ? payload.ts
      : new Date().toISOString()

  if (channel === SQUISHY_CHANNEL) {
    const actor =
      typeof payload.by === 'string'
        ? payload.by
        : 'unknown'
    // Synthetic IDs — pub/sub doesn't carry the DB row id, but the client
    // just needs SOMETHING stable for React keys. `ts+actor` collides only
    // when the same user changes the same setting twice in the same ms.
    return {
      bot: 'squishy',
      id: `squishy:${ts}:${actor}:${String(payload.key ?? '')}`,
      ts,
      actor,
      action: 'setting.changed',
      summary: squishySummary({
        key: payload.key,
        oldValue: payload.oldValue,
        newValue: payload.newValue,
      }),
      raw: payload,
    }
  }

  if (channel === OTTER_CHANNEL) {
    const actor =
      typeof payload.actorDiscordId === 'string'
        ? payload.actorDiscordId
        : 'unknown'
    const action =
      typeof payload.action === 'string' ? payload.action : 'unknown'
    return {
      bot: 'otter',
      id: `otter:${ts}:${actor}:${action}`,
      ts,
      actor,
      action,
      summary: otterSummary({
        businessId: payload.businessId,
        targetType: payload.targetType,
        targetId: payload.targetId,
        success: payload.success,
      }),
      raw: payload,
    }
  }

  return null
}

export const GET = withAuth(
  async (req: NextRequest) => {
    const sub = getSubscriber()
    const encoder = new TextEncoder()

    let heartbeat: NodeJS.Timeout | null = null
    let pmessageHandler: ((pattern: string, channel: string, message: string) => void) | null = null
    let closed = false

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (data: string) => {
          if (closed) return
          try {
            controller.enqueue(encoder.encode(data))
          } catch {
            // Controller already closed by abort — swallow.
          }
        }

        // Hello frame so the client knows the stream is alive immediately,
        // before any audit event arrives.
        send(`: connected\n\n`)

        pmessageHandler = (_pattern, channel, message) => {
          if (channel !== SQUISHY_CHANNEL && channel !== OTTER_CHANNEL) return
          const entry = normalize(channel, message)
          if (!entry) return
          send(`data: ${JSON.stringify(entry)}\n\n`)
        }
        sub.on('pmessage', pmessageHandler)

        // Subscribe (idempotent — ioredis will no-op if already subscribed to
        // the exact pattern). Re-subscribe on reconnect so a Redis restart
        // doesn't silently kill the tail.
        const resubscribe = () => {
          sub.psubscribe(SQUISHY_CHANNEL, OTTER_CHANNEL).catch((err: Error) => {
            console.warn(`[audit/stream] psubscribe failed: ${err.message}`)
          })
        }
        resubscribe()
        sub.on('connect', resubscribe)

        heartbeat = setInterval(() => {
          send(`: keep-alive ${Date.now()}\n\n`)
        }, HEARTBEAT_MS)

        const cleanup = () => {
          if (closed) return
          closed = true
          if (heartbeat) {
            clearInterval(heartbeat)
            heartbeat = null
          }
          if (pmessageHandler) {
            sub.off('pmessage', pmessageHandler)
            sub.off('connect', resubscribe)
            pmessageHandler = null
          }
          // NOTE: we intentionally do NOT `punsubscribe` — the redis
          // subscriber is a shared singleton and other tabs/clients may
          // still need the same pattern. Letting the subscription persist
          // is cheap (a single PSUB on Redis) and avoids races between
          // concurrent /audit/stream clients.
          try {
            controller.close()
          } catch {
            // Already closed.
          }
        }

        req.signal.addEventListener('abort', cleanup)
      },
      cancel() {
        closed = true
        if (heartbeat) {
          clearInterval(heartbeat)
          heartbeat = null
        }
        if (pmessageHandler) {
          sub.off('pmessage', pmessageHandler)
          pmessageHandler = null
        }
      },
    })

    return new NextResponse(stream, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    })
  },
  { require: 'sudo' },
)

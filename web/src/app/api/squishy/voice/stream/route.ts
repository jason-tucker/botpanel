/**
 * SSE firehose for `bot.squishy.voice.*` events.
 *
 * Why this shape:
 *  - Node runtime (NOT edge): ioredis is a TCP client and needs Node's `net`
 *    module. Edge runtime would silently fail at import.
 *  - psubscribe via the shared lazy-singleton subscriber from `lib/redis.ts`.
 *    The subscriber may be shared across many concurrent streams, but each
 *    HTTP request gets its own per-stream `pmessage` listener which we
 *    attach on open and detach on close — so one client disconnecting never
 *    starves the others.
 *  - Heartbeat comment frame `: ping\n\n` every 30s. Cloudflare's idle
 *    timeout is 100s; 30s gives plenty of margin and is cheap.
 *  - Gated by `withAuth({ require: 'sudo' })` — non-sudo callers must not
 *    be able to tap the firehose. The middleware already gates the page
 *    route; this is defense in depth at the API surface.
 */
import type { NextRequest } from 'next/server'
import { withAuth } from '@/lib/auth/middleware'
import { getSubscriber } from '@/lib/redis'

// Node runtime is required — ioredis won't load on the edge.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PATTERN = 'bot.squishy.voice.*'
const HEARTBEAT_MS = 30_000

export const GET = withAuth(
  async (req: NextRequest) => {
    const sub = getSubscriber()
    const encoder = new TextEncoder()

    // We attach our pmessage handler to the shared subscriber. Two reasons
    // we don't use a per-request Redis client:
    //  1. The bot may emit voice events frequently and opening a fresh
    //     subscriber per SSE viewer multiplies socket count needlessly.
    //  2. ioredis' subscriber mode is process-wide — we already have one.
    // Trade-off: every open stream evaluates the channel filter, but the
    // pattern match is dirt-cheap.
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null
    let onPmessage: ((pattern: string, channel: string, message: string) => void) | null = null
    let closed = false

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        // Initial comment so proxies flush the response head immediately
        // and the client knows the connection is alive.
        controller.enqueue(encoder.encode(`: connected\n\n`))

        onPmessage = (_pattern: string, channel: string, message: string) => {
          if (closed) return
          // Channel format: bot.squishy.voice.<event>
          const parts = channel.split('.')
          if (parts.length !== 4 || parts[0] !== 'bot' || parts[1] !== 'squishy' || parts[2] !== 'voice') {
            return
          }
          const event = parts[3]
          let parsed: unknown
          try {
            parsed = JSON.parse(message)
          } catch {
            // Bad publisher — skip rather than poison the stream.
            return
          }
          const frame = `data: ${JSON.stringify({ event, payload: parsed })}\n\n`
          try {
            controller.enqueue(encoder.encode(frame))
          } catch {
            // Controller closed underneath us (client gone); cleanup runs
            // via the abort signal below.
          }
        }

        sub.on('pmessage', onPmessage)
        // Subscribe (idempotent on the shared client). If it fails because
        // Redis is down, ioredis will retry on reconnect — the page will
        // simply not see events until the bus is back.
        sub.psubscribe(PATTERN).catch((err: Error) => {
          console.warn(`voice/stream: psubscribe failed: ${err.message}`)
        })

        heartbeatTimer = setInterval(() => {
          if (closed) return
          try {
            controller.enqueue(encoder.encode(`: ping\n\n`))
          } catch {
            // ignored — close path will handle it
          }
        }, HEARTBEAT_MS)

        // Client disconnect — Next.js wires the request's AbortSignal.
        req.signal.addEventListener('abort', () => {
          if (closed) return
          closed = true
          if (heartbeatTimer) clearInterval(heartbeatTimer)
          if (onPmessage) sub.off('pmessage', onPmessage)
          // Do NOT punsubscribe — other concurrent streams may still want
          // these events. The shared subscriber stays subscribed for the
          // lifetime of the process.
          try {
            controller.close()
          } catch {
            // already closed
          }
        })
      },
      cancel() {
        if (closed) return
        closed = true
        if (heartbeatTimer) clearInterval(heartbeatTimer)
        if (onPmessage) sub.off('pmessage', onPmessage)
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store, no-cache, no-transform, must-revalidate',
        Connection: 'keep-alive',
        // Hint to any intermediary (nginx-style) to not buffer the response.
        'X-Accel-Buffering': 'no',
      },
    })
  },
  { require: 'sudo' },
)

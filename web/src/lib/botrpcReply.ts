/**
 * Bot RPC reply signing and verification (pure; imports only node:crypto so
 * a scratch script can load it with `node --experimental-strip-types`).
 *
 * Scheme (same secret and style as the request HMAC in `botrpc.ts`):
 *   body = JSON.stringify(result)   // {ok, data? | error?, details?}; no top-level ts/hmac
 *   ts   = Date.now()
 *   hmac = HMAC-SHA256(BOTPANEL_RPC_SECRET, `res.${requestId}|${requestId}|${ts}|${body}`)
 *   publish(`res.${requestId}`, {...result, ts, hmac})
 *
 * The panel strips `ts` and `hmac`, re-stringifies the rest (key order
 * survives JSON parse/stringify), recomputes and compares in constant time,
 * and requires |now - ts| <= REPLY_REPLAY_WINDOW_MS.
 *
 * Limitation: with one shared secret, any bot can sign any reply. This only
 * stops a Redis client that does not hold the secret.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'

/** Same window as otterbot's request REPLAY_WINDOW_MS. */
export const REPLY_REPLAY_WINDOW_MS = 30_000

export type ReplyIgnoreReason =
  | 'bad-signature-format'
  | 'bad-hmac'
  | 'stale'
  | 'unsigned-required'

export type ReplyCheck =
  | { kind: 'accept'; value: unknown; signed: boolean }
  | { kind: 'ignore'; reason: ReplyIgnoreReason }

export interface VerifyReplyOptions {
  secret: string
  requestId: string
  /** True when this bot is listed in BOTPANEL_RPC_REQUIRE_SIGNED_REPLIES. */
  requireSigned: boolean
  /** Injectable clock for tests. */
  now?: number
}

function replyMessage(requestId: string, ts: number, body: string): string {
  return `res.${requestId}|${requestId}|${ts}|${body}`
}

function hmacHex(secret: string, message: string): string {
  return createHmac('sha256', secret).update(message).digest('hex')
}

/** Constant-time string compare; a length mismatch returns false, never throws. */
export function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

/**
 * Sign a reply the way the bots will. Exported for tests and as the
 * reference implementation for the bot-side `sendReply`.
 */
export function signReply(
  secret: string,
  requestId: string,
  result: Record<string, unknown>,
  ts: number = Date.now(),
): Record<string, unknown> {
  const body = JSON.stringify(result)
  return { ...result, ts, hmac: hmacHex(secret, replyMessage(requestId, ts, body)) }
}

/**
 * Decide what to do with a parsed reply. `ignore` means: drop this message
 * and keep listening (a forged reply must neither be accepted nor win the
 * race to force an error). An accepted signed reply has `ts`/`hmac` removed.
 * An accepted unsigned reply is returned unchanged (today's behaviour).
 */
export function verifyReply(parsed: unknown, opts: VerifyReplyOptions): ReplyCheck {
  const signed = isPlainObject(parsed) && Object.hasOwn(parsed, 'hmac')
  if (!signed) {
    if (opts.requireSigned) return { kind: 'ignore', reason: 'unsigned-required' }
    return { kind: 'accept', value: parsed, signed: false }
  }

  const { ts, hmac, ...rest } = parsed as Record<string, unknown>
  if (typeof hmac !== 'string' || typeof ts !== 'number' || !Number.isFinite(ts)) {
    return { kind: 'ignore', reason: 'bad-signature-format' }
  }
  // A forged reply can make stringify throw (RangeError on deep nesting, a
  // throwing toJSON, BigInt). That must be an ignore, never an escape.
  let expected: string
  try {
    expected = hmacHex(opts.secret, replyMessage(opts.requestId, ts, JSON.stringify(rest)))
  } catch {
    return { kind: 'ignore', reason: 'bad-hmac' }
  }
  if (!safeEqualHex(hmac, expected)) return { kind: 'ignore', reason: 'bad-hmac' }

  const now = opts.now ?? Date.now()
  if (Math.abs(now - ts) > REPLY_REPLAY_WINDOW_MS) return { kind: 'ignore', reason: 'stale' }

  return { kind: 'accept', value: rest, signed: true }
}

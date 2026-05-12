/**
 * HMAC-SHA256 helpers for the panel ↔ bot command bus envelope.
 *
 * The bot side computes the same HMAC over the same canonical message
 * (`${channel}|${requestId}|${ts}|${JSON.stringify(params)}`) using
 * `BOTPANEL_RPC_SECRET`. On mismatch the bot drops silently — our caller
 * times out and surfaces a generic timeout error. That's intentional:
 * a "bad HMAC" reply would let a network observer probe the secret by
 * watching response timing.
 *
 * `timingSafeCompare` wraps node's `timingSafeEqual` with a length-tolerant
 * front door — different lengths return false fast (and that's NOT a
 * meaningful timing leak because our HMAC outputs are always 64 hex chars,
 * so any honest comparison is fixed-length anyway).
 *
 * Kept separate from `hash.ts` (which uses SHA-256 for audit-row salting)
 * because the use-cases are unrelated and conflating them in one file
 * makes the salting helper look like an authn primitive. Two small files
 * with focused JSDoc beats one ambiguous one.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'

export function hmacSha256(secret: string, message: string): string {
  return createHmac('sha256', secret).update(message).digest('hex')
}

export function timingSafeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  try {
    const ab = Buffer.from(a, 'utf8')
    const bb = Buffer.from(b, 'utf8')
    if (ab.length !== bb.length) return false
    return timingSafeEqual(ab, bb)
  } catch {
    return false
  }
}

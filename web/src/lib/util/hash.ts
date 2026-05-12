/**
 * Cheap stable hash for short strings (IPs, User-Agents) that we want to
 * record in audit rows without storing the plaintext. SHA-256 is overkill
 * for collision resistance on a few-byte input, but it's the only built-in
 * with no extra dependency footprint and we already need it for OAuth flows.
 *
 * The salt is per-deploy via `env.AUDIT_HASH_SALT`. Same plaintext + same
 * salt ⇒ same hash so we can correlate rows; different salts across
 * deploys are intentional (rotating the salt invalidates correlation,
 * which is exactly what we want when retiring a compromised log).
 */
import { createHash } from 'node:crypto'

export function sha256Hex(salt: string, input: string): string {
  return createHash('sha256').update(salt).update('|').update(input).digest('hex')
}

import { cookies } from 'next/headers'
import { SignJWT, jwtVerify } from 'jose'
import { env } from '@/lib/env'

/**
 * Session cookie. JWT signed with HS512 via `jose`. Stored under the `__Host-`
 * prefix so it's tightly scoped to this origin (no Domain attr, Secure, Path=/).
 * Sliding TTL — every page render rolls it forward.
 */

const COOKIE_NAME = '__Host-session'
const TTL_SECONDS = 60 * 60 * 24 * 3  // 3 days
const ALG = 'HS512'

export interface Session {
  id: string
  username: string
  global_name?: string | null
  avatar?: string | null
  /**
   * Discord guild IDs the user is a member of, captured at login from the
   * OAuth `guilds` scope. Used by the sidebar (and similar UI gates) to
   * hide bot-specific nav for users who aren't in the relevant guild.
   *
   * Optional because pre-existing JWTs minted before this field was added
   * don't have it — readers MUST treat `undefined` as "unknown" rather
   * than "empty" (use the prior visibility flags as a fallback). New
   * logins always set this from `https://discord.com/api/users/@me/guilds`.
   */
  guildIds?: string[]
  issuedAt: number
}

function key(): Uint8Array {
  if (!env.SESSION_SECRET) {
    // Foundation phase — auth is optional. Without a secret, no session.
    throw new Error('SESSION_SECRET not set — log in flow is disabled until you configure it')
  }
  return new TextEncoder().encode(env.SESSION_SECRET)
}

export async function mintSession(s: Omit<Session, 'issuedAt'>): Promise<string> {
  return await new SignJWT({ ...s, issuedAt: Math.floor(Date.now() / 1000) })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime(`${TTL_SECONDS}s`)
    .sign(key())
}

export async function setSessionCookie(token: string): Promise<void> {
  const c = await cookies()
  c.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: TTL_SECONDS,
  })
}

export async function clearSessionCookie(): Promise<void> {
  const c = await cookies()
  c.delete(COOKIE_NAME)
}

export async function getSession(): Promise<Session | null> {
  if (!env.SESSION_SECRET) return null
  const c = await cookies()
  const token = c.get(COOKIE_NAME)?.value
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: [ALG] })
    return payload as unknown as Session
  } catch {
    return null
  }
}

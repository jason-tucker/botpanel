import { cookies } from 'next/headers'
import { SignJWT, jwtVerify } from 'jose'
import { randomBytes } from 'node:crypto'
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
  /**
   * Server-side session id, 24 random hex bytes. Mirrored into the
   * `panel_sessions` table as the primary key so admin tooling
   * (e.g. `/api/admin/auth/logout-all`) can identify and exclude the
   * actor's own row when wiping every other session. Optional because
   * pre-V3-3 JWTs don't have it — readers treat `undefined` as "no DB
   * row to look up" (everything degrades to the existing JWT-only flow).
   */
  jti?: string
  issuedAt: number
}

/**
 * Generate a server-side session id. 24 bytes (192 bits) of CSPRNG entropy
 * is overkill for cookie collision resistance but matches the `requestId`
 * length used elsewhere in this codebase (`src/lib/botrpc.ts`), so any
 * later log-grepping is uniform.
 */
export function newJti(): string {
  return randomBytes(24).toString('hex')
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
  // `__Host-` cookies require Secure + Path=/ on EVERY Set-Cookie, including
  // the one that clears them. `cookies().delete()` omits those, so the browser
  // ignores the deletion and logout silently leaves the session cookie in
  // place (the user stays logged in). Overwrite with a matching expired cookie
  // instead. See viewAs.ts clearViewAsCookie for the same fix + rationale.
  c.set(COOKIE_NAME, '', {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  })
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

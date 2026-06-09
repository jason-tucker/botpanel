/**
 * View-As cookie helper.
 *
 * The server-side auth model in `./perms.ts` already accepts
 * `resolveAccess(session, { viewAsUserId })`. This module owns the
 * cookie that the panel uses to pass that ID along the request lifecycle
 * — set by `POST /api/sudo/view-as`, cleared by `DELETE /api/sudo/view-as`,
 * read by `withAuth` (so API routes see the impersonated capabilities) and
 * by the `(dashboard)` layout (so the sidebar and banner reflect the
 * impersonation).
 *
 * Cookie name uses the `__Host-` prefix to inherit the same origin scope
 * as the session cookie — Secure, Path=/, no Domain. SameSite=Lax matches
 * the session cookie. Not HttpOnly is fine: the value is a Discord
 * snowflake; an attacker who could read it would learn who the sudo is
 * impersonating, not anything they couldn't see by looking at the banner.
 *
 * Lifetime: 12h. Long enough that an operator's session doesn't keep
 * forgetting whom they're impersonating mid-investigation, short enough
 * that walking away from your laptop won't leave View-As live for days.
 * The session cookie is 3 days — View-As intentionally expires sooner.
 */
import { cookies } from 'next/headers'
import type { NextRequest } from 'next/server'

export const VIEW_AS_COOKIE = '__Host-view-as'
const TTL_SECONDS = 60 * 60 * 12 // 12h

const SNOWFLAKE_RE = /^\d{15,25}$/

/**
 * Read the View-As user id from cookies (next/headers, for layouts and
 * server-component pages). Returns null if absent or malformed.
 */
export async function getViewAsUserId(): Promise<string | null> {
  const c = await cookies()
  const v = c.get(VIEW_AS_COOKIE)?.value
  if (!v || !SNOWFLAKE_RE.test(v)) return null
  return v
}

/**
 * Same as `getViewAsUserId` but reads from a `NextRequest`. Used by the
 * `withAuth` middleware which operates on the request object directly.
 */
export function getViewAsUserIdFromRequest(req: NextRequest): string | null {
  const v = req.cookies.get(VIEW_AS_COOKIE)?.value
  if (!v || !SNOWFLAKE_RE.test(v)) return null
  return v
}

export async function setViewAsCookie(userId: string): Promise<void> {
  if (!SNOWFLAKE_RE.test(userId)) {
    throw new Error('viewAs: refusing to set non-snowflake value')
  }
  const c = await cookies()
  c.set(VIEW_AS_COOKIE, userId, {
    httpOnly: false,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: TTL_SECONDS,
  })
}

export async function clearViewAsCookie(): Promise<void> {
  const c = await cookies()
  // DO NOT use `c.delete()` here. A `__Host-`-prefixed cookie can only be
  // mutated by a Set-Cookie that itself satisfies the prefix rules (Secure +
  // Path=/, no Domain). `cookies().delete()` emits a bare expiry WITHOUT
  // Secure/Path, so the browser rejects it and the cookie never clears —
  // leaving the operator stuck in View-As (Exit appears to do nothing, and
  // only manually clearing cookies escapes). Overwrite with an already-expired
  // cookie carrying the SAME attributes we set it with; that Set-Cookie is
  // valid and actually removes it.
  c.set(VIEW_AS_COOKIE, '', {
    httpOnly: false,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  })
}

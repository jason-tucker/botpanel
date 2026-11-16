import { cache } from 'react'
import { cookies } from 'next/headers'
import { SignJWT, jwtVerify } from 'jose'
import { randomBytes } from 'node:crypto'
import { env } from '@/lib/env'
import { createSessionValidator, type SessionValidator } from './sessionValidator'

/**
 * Session cookie. JWT signed with HS512 via `jose`. Stored under the `__Host-`
 * prefix so it's tightly scoped to this origin (no Domain attr, Secure, Path=/).
 * Fixed TTL: the JWT expires 3 days after login (it is only minted by the
 * OAuth callback; nothing rolls it forward). When the session store is
 * configured, `getSession()` also requires a live `panel_sessions` row for
 * the JWT's `jti`, so deleting the row revokes the session.
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
   * logins set this from `https://discord.com/api/users/@me/guilds`,
   * filtered down to the guilds the panel actually checks (currently only
   * `GUILD_ID`). The full list (up to 200 IDs) pushed the cookie past the
   * browser's 4096-byte limit, which drops it silently.
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

/**
 * Browsers silently drop a cookie whose name + value exceeds ~4096 bytes,
 * leaving the user signed out with no error. Stay well under that.
 */
export const SESSION_COOKIE_MAX_BYTES = 3800

/** Bytes the browser counts against its per-cookie limit (name=value). */
export function sessionCookieBytes(token: string): number {
  return COOKIE_NAME.length + 1 + token.length
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

/**
 * The cookie's claims after checking only the JWT signature and expiry —
 * NOT whether the session was revoked. Use `getSession()` for auth; this
 * is for logout, which must find the jti of a session it is ending.
 */
export async function readSessionClaims(): Promise<Session | null> {
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

/**
 * Does `panel_sessions` hold a live row for this jti + user? Primary-key
 * lookup; the user_id bind is defence in depth. Rows older than the JWT
 * TTL don't count (the JWT would have expired anyway). Runs with a 1 s
 * DB-side statement_timeout, so a query the validator gave up on (750 ms)
 * still frees its pool connection soon after.
 */
async function lookupSessionRow(jti: string, userId: string): Promise<boolean> {
  const [{ squishyDb }, { sessions: panelSessions }, { and, eq, sql }] = await Promise.all([
    import('@/lib/db/squishy'),
    import('@/lib/db/schema/panel/sessions'),
    import('drizzle-orm'),
  ])
  const rows = await squishyDb.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL statement_timeout = '1s'`)
    return tx
      .select({ one: sql<number>`1` })
      .from(panelSessions)
      .where(
        and(
          eq(panelSessions.id, jti),
          eq(panelSessions.userId, userId),
          sql`${panelSessions.createdAt} > now() - interval '3 days'`,
        ),
      )
      .limit(1)
  })
  return rows.length > 0
}

/** Lazy-create `panel_sessions` (no-op once it succeeded in this process). */
async function preparePanelSessions(): Promise<void> {
  const { ensurePanelSessionsTable } = await import('@/lib/db/panelSessions')
  await ensurePanelSessionsTable()
}

// One validator per process: 30 s verdict cache, 750 ms cap per check, 5 min
// stale grace for sessions seen recently, 2 s back-off after a failed
// lookup (see sessionValidator.ts). The lazy CREATE TABLE runs as its
// `prepare` step, inside the same 750 ms budget; a slow one is not waited
// on again until it settles.
let _validator: SessionValidator | null = null
function validator(): SessionValidator {
  if (!_validator) {
    _validator = createSessionValidator({ lookup: lookupSessionRow, prepare: preparePanelSessions })
  }
  return _validator
}

/** Record a session whose row this process just inserted (OAuth callback). */
export function seedSession(jti: string, userId: string): void {
  validator().seed(jti, userId)
}

/** Drop this process's cached verdict for a session (after deleting its row). */
export function forgetSession(jti: string): void {
  validator().forget(jti)
}

/** Drop every cached verdict except `keepJti` (after logout-all). */
export function forgetOtherSessions(keepJti: string | null): void {
  validator().clearExcept(keepJti)
}

let _warnedNoStore = false
const UNAVAILABLE_WARN_MS = 30_000
let _lastUnavailableWarnAt = 0

/**
 * Is the session behind these (already signature- and expiry-checked)
 * claims still live? This is `getSession()`'s revocation check, exported so
 * long-lived responses (the SSE streams) can repeat it on each heartbeat.
 * True when no session store is configured; false for a JWT without a jti,
 * a revoked session, or a store that can't answer beyond the stale grace.
 */
export async function isSessionLive(claims: Pick<Session, 'id' | 'jti'>): Promise<boolean> {
  if (!env.SQUISHY_DATABASE_URL) {
    // Dev / auth-only deploys: there is no session store to check.
    if (!_warnedNoStore) {
      _warnedNoStore = true
      console.warn('[session] SQUISHY_DATABASE_URL not set — session revocation disabled')
    }
    return true
  }
  // Pre-V3-3 JWTs carry no jti and so have no row (all such JWTs have
  // expired by now anyway: the TTL is 3 days).
  if (!claims.jti) return false
  const verdict = await validator().check(claims.jti, claims.id)
  if (verdict === 'unavailable') {
    const t = Date.now()
    if (t - _lastUnavailableWarnAt >= UNAVAILABLE_WARN_MS) {
      _lastUnavailableWarnAt = t
      console.warn('[session] session store unavailable — treating requests as logged out (logged at most every 30 s)')
    }
  }
  return verdict === 'valid'
}

/**
 * Per-request memoized via React `cache()`: the `(dashboard)` layout and
 * every page under it each call `getSession()` in the same render pass,
 * so without the memo we verify the same JWT twice per navigation. The
 * cookie can't change mid-render (the only mutators are route handlers,
 * where React's cache scope is absent and the function runs uncached —
 * the validator's own 30 s cache keeps that cheap), so memoizing is safe.
 *
 * Revocation: with SQUISHY_DATABASE_URL set, the JWT's jti must match a
 * live `panel_sessions` row. Fails closed: a revoked session, a JWT without
 * a jti, or a session store that can't answer (beyond the 5 min stale grace)
 * all read as logged out. The cookie is kept, so a session whose row still
 * exists resumes once the DB is back.
 */
export const getSession = cache(async (): Promise<Session | null> => {
  const claims = await readSessionClaims()
  if (!claims) return null
  return (await isSessionLive(claims)) ? claims : null
})

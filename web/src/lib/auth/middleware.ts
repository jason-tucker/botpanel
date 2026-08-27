/**
 * `withAuth(handler, opts?)` — the only auth wrapper for route handlers.
 *
 * - Pulls the JWT session out of the cookie.
 * - Resolves the full AccessMap once, hands it to the handler.
 * - Gates on capability, not tier: `'any'` (logged in), `'sudo'`
 *   (Squishy sudo OR bot owner), `'botOwner'`.
 * - Verifies CSRF on every state-changing method (POST/PUT/PATCH/
 *   DELETE) unless `csrf: false` is passed — see ./csrf.ts for the
 *   double-submit cookie pattern. GETs bypass CSRF entirely because
 *   they're idempotent reads.
 * - Optionally rate-limits per-actor with an in-memory token bucket
 *   (`rateLimit: { points, perSeconds }`). Memory-only for MVP —
 *   single-process panel today; a redis-backed limiter is V2.5.
 *
 * Pages should call `resolveAccess()` directly in their layout — they
 * need the map for rendering, not just gating. Reserve this wrapper for
 * API routes.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getSession, type Session } from './session'
import { resolveAccess, type AccessMap } from './perms'
import { verifyCsrfToken } from './csrf'
import { getViewAsUserIdFromRequest } from './viewAs'
import { env } from '../env'

export type AuthRequirement = 'any' | 'sudo' | 'botOwner'

export type AuthedHandler<T extends unknown[]> = (
  req: NextRequest,
  access: AccessMap,
  ...args: T
) => Promise<Response> | Response

export type RateLimitSpec = {
  points: number
  perSeconds: number
  /**
   * Optional override for the bucket key. Defaults to
   * `${actor.id}:${routeKey}` — the route key is the wrapper's
   * caller-id (derived from the handler function name) so each
   * route gets its own bucket without collisions.
   */
  key?: (req: NextRequest, access: AccessMap) => string
}

export type WithAuthOptions = {
  require?: AuthRequirement
  csrf?: boolean
  rateLimit?: RateLimitSpec
  /**
   * `false` skips capability resolution (Postgres sudo/voice lookups +
   * the otter-ranks bot RPC) and hands the handler a session-only
   * AccessMap: identity from the JWT, `botOwner` from the env compare
   * (pure, no I/O), everything else empty. View-As is intentionally NOT
   * honored in this mode (no caps to gate the impersonation with), so
   * `viewing === actor` always.
   *
   * ONLY honored with `require: 'any'` — sudo/botOwner gates need the
   * real capability map, so anything stricter forces full resolution
   * regardless of this flag. Use for hot, frequently-polled endpoints
   * whose handler never reads capabilities (health pills, CSRF
   * issuance, push config) so a 30s poll doesn't cost two Postgres
   * round-trips per client. Defaults to true (full resolution).
   */
  resolveCaps?: boolean
}

// ─── In-memory rate-limit bucket store ──────────────────────────────
// Keyed by string; value is a sliding-window queue of timestamps.
// We use a Map of arrays — for MVP traffic (single-digit RPS panel)
// this is fine and avoids pulling a token-bucket dep. The map can
// grow unbounded if many distinct keys are used, but a cheap cleanup
// runs on every check (drop expired stamps) so memory stays bounded
// by `points × active-keys`.
const buckets: Map<string, number[]> = new Map()

function checkRateLimit(key: string, points: number, perSeconds: number): boolean {
  const now = Date.now()
  const windowMs = perSeconds * 1000
  const cutoff = now - windowMs
  const arr = buckets.get(key) ?? []
  // Drop expired stamps in place.
  let i = 0
  while (i < arr.length && arr[i] < cutoff) i++
  const live = i === 0 ? arr : arr.slice(i)
  if (live.length >= points) {
    buckets.set(key, live)
    return false
  }
  live.push(now)
  buckets.set(key, live)
  return true
}

/**
 * Session-only AccessMap for `resolveCaps: false` routes. No I/O — the
 * identity comes straight from the JWT and `botOwner` is a pure env
 * compare. Capabilities are all empty, which is strictly LESS privilege
 * than full resolution would grant, so this can never widen access.
 */
function sessionOnlyAccess(session: Session): AccessMap {
  const identity = {
    id: session.id,
    username: session.username,
    avatar: session.avatar ?? null,
  }
  return {
    actor: identity,
    viewing: identity,
    botOwner: session.id === env.BOT_OWNER_ID,
    squishy: { sudo: false, voiceChannels: [], canSelfEdit: true },
    otter: { businesses: {}, roleIds: [] },
  }
}

function defaultRateLimitKey(req: NextRequest, access: AccessMap): string {
  // Path keeps each route's bucket independent so a flood on /foo
  // doesn't lock /bar. Actor is the REAL user — View-As doesn't
  // grant a separate quota.
  const path = new URL(req.url).pathname
  return `${access.actor.id}:${path}`
}

export function withAuth<T extends unknown[]>(
  handler: AuthedHandler<T>,
  opts?: WithAuthOptions,
): (req: NextRequest, ...args: T) => Promise<Response> {
  const required: AuthRequirement = opts?.require ?? 'any'
  // CSRF defaults to ON. Callers opt out for GET-only endpoints
  // like /api/csrf itself (which has to return the token before
  // any token exists to verify).
  const csrfEnabled = opts?.csrf !== false

  return async (req: NextRequest, ...args: T): Promise<Response> => {
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }

    // Read the View-As cookie off the request. `resolveAccess` is the
    // gatekeeper: if the actor isn't sudo / bot-owner the impersonation
    // is silently ignored (no privilege escalation), and self-View-As
    // short-circuits to the real identity. Worst-case for a forged
    // cookie on a non-sudo session is a no-op.
    //
    // `resolveCaps: false` (only honored for `require: 'any'`) skips the
    // capability lookups entirely — see WithAuthOptions for the contract.
    const skipCaps = opts?.resolveCaps === false && required === 'any'
    let access: AccessMap
    if (skipCaps) {
      access = sessionOnlyAccess(session)
    } else {
      const viewAsUserId = getViewAsUserIdFromRequest(req)
      access = await resolveAccess(session, viewAsUserId ? { viewAsUserId } : undefined)
    }

    const passes =
      required === 'any'
        ? true
        : required === 'sudo'
          ? access.squishy.sudo || access.botOwner
          : required === 'botOwner'
            ? access.botOwner
            : false

    if (!passes) {
      return NextResponse.json(
        { error: 'forbidden', required },
        { status: 403 },
      )
    }

    // CSRF check — only on state-changing methods, only when
    // not explicitly disabled by the caller.
    if (csrfEnabled && req.method !== 'GET' && req.method !== 'HEAD') {
      const ok = await verifyCsrfToken(req)
      if (!ok) {
        return NextResponse.json({ error: 'csrf' }, { status: 403 })
      }
    }

    // Rate limit — actor-keyed in-memory bucket.
    if (opts?.rateLimit) {
      const keyFn = opts.rateLimit.key ?? defaultRateLimitKey
      const k = keyFn(req, access)
      if (!checkRateLimit(k, opts.rateLimit.points, opts.rateLimit.perSeconds)) {
        return NextResponse.json(
          {
            error: 'rate_limited',
            retryAfter: opts.rateLimit.perSeconds,
          },
          {
            status: 429,
            headers: {
              'Retry-After': String(opts.rateLimit.perSeconds),
            },
          },
        )
      }
    }

    return handler(req, access, ...args)
  }
}

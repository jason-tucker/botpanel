/**
 * `withAuth(handler, opts?)` — the only auth wrapper for route handlers.
 *
 * - Pulls the JWT session out of the cookie.
 * - Resolves the full AccessMap once, hands it to the handler.
 * - Gates on capability, not tier: `'any'` (logged in), `'sudo'`
 *   (Squishy sudo OR bot owner), `'botOwner'`.
 *
 * Pages should call `resolveAccess()` directly in their layout — they
 * need the map for rendering, not just gating. Reserve this wrapper for
 * API routes.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from './session'
import { resolveAccess, type AccessMap } from './perms'

export type AuthRequirement = 'any' | 'sudo' | 'botOwner'

export type AuthedHandler<T extends unknown[]> = (
  req: NextRequest,
  access: AccessMap,
  ...args: T
) => Promise<Response> | Response

export function withAuth<T extends unknown[]>(
  handler: AuthedHandler<T>,
  opts?: { require?: AuthRequirement },
): (req: NextRequest, ...args: T) => Promise<Response> {
  const required: AuthRequirement = opts?.require ?? 'any'

  return async (req: NextRequest, ...args: T): Promise<Response> => {
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }

    const access = await resolveAccess(session)

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

    return handler(req, access, ...args)
  }
}

/**
 * POST/DELETE /api/sudo/view-as — start / stop impersonating another user.
 *
 * Gate: `require: 'sudo'` — Squishy sudo OR bot owner. The double check on
 * `access.botOwner || access.squishy.sudo` inside the handler is redundant
 * but kept as a defense-in-depth assertion (cheap & makes the intent
 * obvious to anyone reading the route in isolation).
 *
 * Cookie: `__Host-view-as` (see `src/lib/auth/viewAs.ts`). Setting the
 * cookie doesn't grant any capability the actor doesn't already have via
 * the `resolveAccess` gate — the cookie is a *view selector*, not an
 * authorization token. A non-sudo holding a forged cookie would still
 * resolve to their own capabilities (perms.ts silently ignores the ID).
 *
 * Audit:
 *   - POST → `auth.view_as_started` with `targetId` = picked user, `after`
 *     = `{ viewing: <id> }`. We pass the picked user as `viewing` on the
 *     audit row directly because at the time of this request the cookie
 *     isn't set yet, so `access.viewing` still equals `access.actor`.
 *   - DELETE → `auth.view_as_ended` with `targetId` = previously-viewed
 *     user (read off the live cookie before clearing). The `viewing`
 *     field on the audit row reflects who the actor was impersonating
 *     at the moment they hit Exit.
 *
 * Self-View-As: explicit 400 with `{ error: 'self' }`. The UI gates this
 * client-side too but the server is the source of truth — the spec calls
 * it pointless and we agree.
 *
 * Redirect: handler returns JSON, the client decides where to go next.
 * Spec suggests `/me` after start, `/sudo` after end — the client-side
 * controls implement that with `router.push`. Keeping redirects out of
 * the API keeps the response uniform.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { withAuth } from '@/lib/auth/middleware'
import { writeAudit } from '@/lib/audit'
import {
  getViewAsUserIdFromRequest,
  setViewAsCookie,
  clearViewAsCookie,
} from '@/lib/auth/viewAs'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SNOWFLAKE_RE = /^\d{15,25}$/

export const POST = withAuth(
  async (req: NextRequest, access) => {
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'invalid-json' }, { status: 400 })
    }
    const userId = (body as { userId?: unknown } | null)?.userId
    if (typeof userId !== 'string' || !SNOWFLAKE_RE.test(userId)) {
      return NextResponse.json(
        { error: 'userId must be a Discord snowflake (15-25 digits)' },
        { status: 400 },
      )
    }

    // Self-View-As — no-op. Don't even set the cookie so the banner
    // doesn't appear pointlessly. Spec calls this a 400 (not silent
    // success) so the UI can surface a clear "pick someone else".
    if (userId === access.actor.id) {
      return NextResponse.json({ error: 'self' }, { status: 400 })
    }

    // Defense-in-depth: `withAuth({ require: 'sudo' })` already gates this
    // route, but the explicit check makes the intent obvious if someone
    // ever loosens the wrapper.
    if (!(access.botOwner || access.squishy.sudo)) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }

    await setViewAsCookie(userId)

    // At this point in the request the cookie isn't on `access` yet
    // (it was just written to the response). For the audit row we
    // override `viewing` to the newly-picked target so the trail
    // captures who the actor STARTED impersonating in a single row.
    await writeAudit({
      bot: 'squishy',
      action: 'auth.view_as_started',
      targetType: 'user',
      targetId: userId,
      actor: access.actor,
      // username field is the AuditActor's denormalized hint — leave
      // blank since we don't have the viewed user's display name here.
      // The targetId carries the snowflake and the audit consumer can
      // resolve it for display.
      viewing: { id: userId },
      before: null,
      after: { viewing: userId },
      success: true,
    }).catch((err) => {
      console.warn('[view-as POST] audit write failed (non-fatal)', err)
    })

    return NextResponse.json({ success: true, viewing: userId })
  },
  {
    require: 'sudo',
    csrf: true,
    rateLimit: { points: 20, perSeconds: 60 },
  },
)

export const DELETE = withAuth(
  async (req: NextRequest, access) => {
    // Capture who we were impersonating BEFORE clearing the cookie so
    // the audit row records the exit target. If no cookie was set we
    // still clear (idempotent) and skip the audit write — there's
    // nothing meaningful to log when there was no live impersonation.
    const wasViewing = getViewAsUserIdFromRequest(req)

    await clearViewAsCookie()

    if (wasViewing && wasViewing !== access.actor.id) {
      await writeAudit({
        bot: 'squishy',
        action: 'auth.view_as_ended',
        targetType: 'user',
        targetId: wasViewing,
        actor: access.actor,
        viewing: { id: wasViewing },
        before: { viewing: wasViewing },
        after: null,
        success: true,
      }).catch((err) => {
        console.warn('[view-as DELETE] audit write failed (non-fatal)', err)
      })
    }

    return NextResponse.json({ success: true })
  },
  {
    require: 'any',
    csrf: true,
    rateLimit: { points: 30, perSeconds: 60 },
  },
)

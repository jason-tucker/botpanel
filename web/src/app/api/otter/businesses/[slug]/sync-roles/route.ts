/**
 * POST /api/otter/businesses/[slug]/sync-roles — request a Discord-side
 * role reconciliation for one business.
 *
 * Gate: **business owner only.** Bot owners do NOT auto-pass — sync-roles
 * touches every member of the business, so the rule "only the business
 * owner can fire it" stays narrow even for sudo. Wider buttons can be
 * added later if a real use case appears.
 *
 * Calls the bot-side `business.sync_roles` RPC verb (Wave 7c-A on otterbot),
 * which walks `business_owners` + `business_role_mappings` and reconciles
 * each candidate member's Discord roles. The bot returns
 * `{added, removed, skipped[]}` for audit.
 *
 * CSRF on. Rate-limited 5/300s/actor — this is a heavy op (walks every
 * member of the business, does N×Discord-API role mutations); a tight
 * window is the right posture.
 *
 * Audit lands `business.sync_roles` with the full `{added, removed,
 * skipped}` payload as `after` so the audit tail shows the reconciliation
 * result, not just "the button was clicked".
 */
import { NextResponse, type NextRequest } from 'next/server'
import { withAuth } from '@/lib/auth/middleware'
import { writeAudit } from '@/lib/audit'
import { callBot } from '@/lib/botrpc'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteCtx = { params: Promise<{ slug: string }> }

type SyncRolesData = {
  added: number
  removed: number
  skipped: string[]
}

export const POST = withAuth<[RouteCtx]>(
  async (req: NextRequest, access, ctx) => {
    const { slug } = await ctx.params

    // Owner-only gate. We intentionally do NOT also let `access.botOwner`
    // through here — bot-owner is the panel-stack escape hatch, not an
    // implicit grant on every business surface. If a sudo needs to fire
    // sync-roles, they can View-As the actual owner.
    const rank = access.otter.businesses[slug]
    if (rank !== 'owner') {
      await writeAudit({
        bot: 'otter',
        actor: access.actor,
        viewing: access.viewing,
        action: 'business.sync_roles',
        targetType: 'business',
        targetId: slug,
        success: false,
        errorMessage: 'forbidden',
      }).catch(() => {})
      return NextResponse.json(
        { ok: false, error: 'forbidden' },
        { status: 403 },
      )
    }

    const reply = await callBot<SyncRolesData>('otter', 'business.sync_roles', {
      businessSlug: slug,
    })

    await writeAudit({
      bot: 'otter',
      actor: access.actor,
      viewing: access.viewing,
      action: 'business.sync_roles',
      targetType: 'business',
      targetId: slug,
      before: null,
      after: reply.ok ? reply.data : null,
      success: reply.ok,
      errorMessage: reply.ok ? null : reply.error,
    }).catch((err) => {
      console.warn('[otter/businesses/sync-roles] audit write failed', err)
    })

    // Mirror the reply shape `{ok, data?, error?}` back to the caller —
    // matches `callBot`'s `BotRpcResult` so the client can render success
    // counts or the error string directly.
    if (reply.ok) {
      return NextResponse.json({ ok: true, data: reply.data })
    }
    return NextResponse.json(
      { ok: false, error: reply.error },
      // 200 — the bot replied, just with an error envelope. Matches the
      // squishy/hubs/lockdown pattern: the `reply.ok` flag is the real
      // success signal, HTTP status reflects only transport health.
      { status: 200 },
    )
  },
  {
    require: 'any',
    csrf: true,
    rateLimit: { points: 5, perSeconds: 300 },
  },
)

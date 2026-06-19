/**
 * POST /api/squishy/self-assign-roles/reorder — reorder self-assign entries.
 *
 * Body: `{ ids: string[] }` — a complete ordered list of entry UUIDs.
 * The bot sets `sort_order` to each entry's position in the array.
 *
 * Delegates to `callBot('squishy','selfassign.reorder',{ids})`.
 * Gating: sudo, CSRF, 30/min.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { withAuth } from '@/lib/auth/middleware'
import { writeAudit } from '@/lib/audit'
import { callBot } from '@/lib/botrpc'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_ENTRIES = 50

export const POST = withAuth(
  async (req: NextRequest, access) => {
    let body: unknown
    try {
      body = await req.json()
    } catch {
      await writeAudit({
        bot: 'squishy',
        action: 'selfassign.reordered',
        actor: access.actor,
        viewing: access.viewing,
        targetType: 'self_assign_entries',
        success: false,
        errorMessage: 'invalid-json',
      }).catch(() => {})
      return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
    }

    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'body must be a JSON object' }, { status: 400 })
    }
    const o = body as Record<string, unknown>

    if (!Array.isArray(o.ids)) {
      return NextResponse.json({ error: 'ids must be an array' }, { status: 400 })
    }
    if (o.ids.length === 0 || o.ids.length > MAX_ENTRIES) {
      return NextResponse.json(
        { error: `ids must contain 1..${MAX_ENTRIES} entries` },
        { status: 400 },
      )
    }
    for (const id of o.ids) {
      if (typeof id !== 'string' || !UUID_RE.test(id)) {
        return NextResponse.json(
          { error: 'each id must be a UUID' },
          { status: 400 },
        )
      }
    }
    const ids: string[] = o.ids as string[]

    const reply = await callBot<Record<string, never>>(
      'squishy',
      'selfassign.reorder',
      { ids },
    )

    if (!reply.ok) {
      await writeAudit({
        bot: 'squishy',
        action: 'selfassign.reordered',
        actor: access.actor,
        viewing: access.viewing,
        targetType: 'self_assign_entries',
        success: false,
        errorMessage: reply.error,
      }).catch(() => {})
      return NextResponse.json(
        { error: reply.error, details: reply.details ?? null },
        { status: 502 },
      )
    }

    await writeAudit({
      bot: 'squishy',
      action: 'selfassign.reordered',
      actor: access.actor,
      viewing: access.viewing,
      targetType: 'self_assign_entries',
      before: null,
      after: { ids },
      success: true,
    }).catch((err) => {
      console.warn('[self-assign-roles/reorder POST] audit write failed', err)
    })

    return NextResponse.json({ ok: true })
  },
  {
    require: 'sudo',
    csrf: true,
    rateLimit: { points: 30, perSeconds: 60 },
  },
)

/**
 * PATCH /api/squishy/self-assign-roles/[id] — update an entry's metadata.
 * DELETE /api/squishy/self-assign-roles/[id] — remove an entry.
 *
 * PATCH body (all optional): `{ label?, description?, emoji?, enabled? }`.
 * At least one field required (400 otherwise).
 *
 * DELETE removes the entry and its posted Discord message (if any) via the bot.
 *
 * Both delegate to the bot via callBot — the bot manages the DB row and any
 * live Discord message editing/deletion. Gating: sudo, CSRF, 30/min.
 * Audit on success and failure.
 *
 * Next.js 15: params is a Promise — always `await ctx.params`.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { withAuth } from '@/lib/auth/middleware'
import { writeAudit } from '@/lib/audit'
import { callBot } from '@/lib/botrpc'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_TEXT_LEN = 100

function parseOptionalText(
  raw: unknown,
  field: string,
): { ok: true; present: boolean; value: string | null } | { ok: false; error: string } {
  if (raw === undefined) return { ok: true, present: false, value: null }
  if (raw === null) return { ok: true, present: true, value: null }
  if (typeof raw !== 'string') {
    return { ok: false, error: `${field} must be a string or null` }
  }
  const trimmed = raw.trim()
  if (trimmed === '') return { ok: true, present: true, value: null }
  if (trimmed.length > MAX_TEXT_LEN) {
    return { ok: false, error: `${field} must be ≤ ${MAX_TEXT_LEN} chars` }
  }
  return { ok: true, present: true, value: trimmed }
}

export const PATCH = withAuth(
  async (
    req: NextRequest,
    access,
    ctx: { params: Promise<{ id: string }> },
  ) => {
    const { id } = await ctx.params
    const entryId = (id ?? '').trim()

    if (!UUID_RE.test(entryId)) {
      await writeAudit({
        bot: 'squishy',
        action: 'selfassign.updated',
        actor: access.actor,
        viewing: access.viewing,
        targetType: 'self_assign_entries',
        targetId: entryId,
        success: false,
        errorMessage: 'invalid-uuid',
      }).catch(() => {})
      return NextResponse.json({ error: 'id must be a UUID' }, { status: 400 })
    }

    let body: Record<string, unknown>
    try {
      body = ((await req.json()) ?? {}) as Record<string, unknown>
    } catch {
      return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
    }

    // Build the patch — only include fields that were supplied.
    const patch: {
      label?: string | null
      description?: string | null
      emoji?: string | null
      enabled?: boolean
    } = {}

    for (const f of ['label', 'description', 'emoji'] as const) {
      const r = parseOptionalText(body[f], f)
      if (!r.ok) {
        return NextResponse.json({ error: r.error }, { status: 400 })
      }
      if (r.present) patch[f] = r.value
    }

    if (body.enabled !== undefined) {
      if (typeof body.enabled !== 'boolean') {
        return NextResponse.json(
          { error: 'enabled must be a boolean' },
          { status: 400 },
        )
      }
      patch.enabled = body.enabled
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json(
        { error: 'no fields to patch — supply at least one field' },
        { status: 400 },
      )
    }

    const reply = await callBot<Record<string, never>>(
      'squishy',
      'selfassign.update',
      { id: entryId, ...patch },
    )

    if (!reply.ok) {
      await writeAudit({
        bot: 'squishy',
        action: 'selfassign.updated',
        actor: access.actor,
        viewing: access.viewing,
        targetType: 'self_assign_entries',
        targetId: entryId,
        before: null,
        after: patch,
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
      action: 'selfassign.updated',
      actor: access.actor,
      viewing: access.viewing,
      targetType: 'self_assign_entries',
      targetId: entryId,
      before: null,
      after: patch,
      success: true,
    }).catch((err) => {
      console.warn('[self-assign-roles PATCH] audit write failed', err)
    })

    return NextResponse.json({ ok: true, id: entryId })
  },
  {
    require: 'sudo',
    csrf: true,
    rateLimit: { points: 30, perSeconds: 60 },
  },
)

export const DELETE = withAuth(
  async (
    _req: NextRequest,
    access,
    ctx: { params: Promise<{ id: string }> },
  ) => {
    const { id } = await ctx.params
    const entryId = (id ?? '').trim()

    if (!UUID_RE.test(entryId)) {
      await writeAudit({
        bot: 'squishy',
        action: 'selfassign.removed',
        actor: access.actor,
        viewing: access.viewing,
        targetType: 'self_assign_entries',
        targetId: entryId,
        success: false,
        errorMessage: 'invalid-uuid',
      }).catch(() => {})
      return NextResponse.json({ error: 'id must be a UUID' }, { status: 400 })
    }

    const reply = await callBot<Record<string, never>>(
      'squishy',
      'selfassign.remove',
      { id: entryId },
    )

    if (!reply.ok) {
      await writeAudit({
        bot: 'squishy',
        action: 'selfassign.removed',
        actor: access.actor,
        viewing: access.viewing,
        targetType: 'self_assign_entries',
        targetId: entryId,
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
      action: 'selfassign.removed',
      actor: access.actor,
      viewing: access.viewing,
      targetType: 'self_assign_entries',
      targetId: entryId,
      before: { id: entryId },
      after: null,
      success: true,
    }).catch((err) => {
      console.warn('[self-assign-roles DELETE] audit write failed', err)
    })

    return NextResponse.json({ ok: true, id: entryId })
  },
  {
    require: 'sudo',
    csrf: true,
    rateLimit: { points: 30, perSeconds: 60 },
  },
)

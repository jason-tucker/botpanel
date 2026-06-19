/**
 * POST /api/squishy/self-assign-roles — add an entry to the self-assign board.
 *
 * Body: `{ kind: 'role'|'game', refId: string, label?: string|null,
 *           description?: string|null, emoji?: string|null }`.
 *
 * `kind` must be 'role' or 'game'. `refId` is a Discord role snowflake when
 * kind='role', or a games.id UUID when kind='game'. Label, description, and
 * emoji are optional overrides (each must be ≤ 100 chars if supplied).
 *
 * Delegates to `callBot('squishy','selfassign.add',...)` — the bot creates
 * the DB row (with guild scoping + sort-order assignment) and returns the
 * new entry's id.
 *
 * Gating: sudo via `withAuth({require:'sudo', csrf:true, rateLimit:{points:30,
 * perSeconds:60}})`. Audit on success and failure.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { withAuth } from '@/lib/auth/middleware'
import { writeAudit } from '@/lib/audit'
import { callBot } from '@/lib/botrpc'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SNOWFLAKE_RE = /^\d{15,25}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_TEXT_LEN = 100

type ParseResult =
  | {
      ok: true
      kind: 'role' | 'game'
      refId: string
      label: string | null
      description: string | null
      emoji: string | null
    }
  | { ok: false; error: string }

function parseOptionalText(
  raw: unknown,
  field: string,
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, value: null }
  if (typeof raw !== 'string') {
    return { ok: false, error: `${field} must be a string or null` }
  }
  const trimmed = raw.trim()
  if (trimmed === '') return { ok: true, value: null }
  if (trimmed.length > MAX_TEXT_LEN) {
    return { ok: false, error: `${field} must be ≤ ${MAX_TEXT_LEN} chars` }
  }
  return { ok: true, value: trimmed }
}

function parseBody(raw: unknown): ParseResult {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'body must be a JSON object' }
  }
  const o = raw as Record<string, unknown>

  const kind = typeof o.kind === 'string' ? o.kind.trim() : ''
  if (kind !== 'role' && kind !== 'game') {
    return { ok: false, error: "kind must be 'role' or 'game'" }
  }

  const refId = typeof o.refId === 'string' ? o.refId.trim() : ''
  if (kind === 'role') {
    if (!SNOWFLAKE_RE.test(refId)) {
      return {
        ok: false,
        error: 'refId must be a Discord role snowflake (15-25 digits) for kind=role',
      }
    }
  } else {
    // kind === 'game': refId is a games.id UUID
    if (!UUID_RE.test(refId)) {
      return {
        ok: false,
        error: 'refId must be a UUID (games.id) for kind=game',
      }
    }
  }

  const lRes = parseOptionalText(o.label, 'label')
  if (!lRes.ok) return { ok: false, error: lRes.error }

  const dRes = parseOptionalText(o.description, 'description')
  if (!dRes.ok) return { ok: false, error: dRes.error }

  const eRes = parseOptionalText(o.emoji, 'emoji')
  if (!eRes.ok) return { ok: false, error: eRes.error }

  return {
    ok: true,
    kind: kind as 'role' | 'game',
    refId,
    label: lRes.value,
    description: dRes.value,
    emoji: eRes.value,
  }
}

export const POST = withAuth(
  async (req: NextRequest, access) => {
    let body: unknown
    try {
      body = await req.json()
    } catch {
      await writeAudit({
        bot: 'squishy',
        action: 'selfassign.added',
        actor: access.actor,
        viewing: access.viewing,
        targetType: 'self_assign_entries',
        success: false,
        errorMessage: 'invalid-json',
      }).catch(() => {})
      return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
    }

    const parsed = parseBody(body)
    if (!parsed.ok) {
      await writeAudit({
        bot: 'squishy',
        action: 'selfassign.added',
        actor: access.actor,
        viewing: access.viewing,
        targetType: 'self_assign_entries',
        success: false,
        errorMessage: parsed.error,
      }).catch(() => {})
      return NextResponse.json({ error: parsed.error }, { status: 400 })
    }

    const reply = await callBot<{ id: string }>(
      'squishy',
      'selfassign.add',
      {
        kind: parsed.kind,
        refId: parsed.refId,
        label: parsed.label,
        description: parsed.description,
        emoji: parsed.emoji,
      },
    )

    if (!reply.ok) {
      await writeAudit({
        bot: 'squishy',
        action: 'selfassign.added',
        actor: access.actor,
        viewing: access.viewing,
        targetType: 'self_assign_entries',
        before: null,
        after: { kind: parsed.kind, refId: parsed.refId },
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
      action: 'selfassign.added',
      actor: access.actor,
      viewing: access.viewing,
      targetType: 'self_assign_entries',
      targetId: reply.data.id,
      before: null,
      after: {
        id: reply.data.id,
        kind: parsed.kind,
        refId: parsed.refId,
        label: parsed.label,
        description: parsed.description,
        emoji: parsed.emoji,
      },
      success: true,
    }).catch((err) => {
      console.warn('[self-assign-roles POST] audit write failed', err)
    })

    return NextResponse.json({ ok: true, id: reply.data.id }, { status: 201 })
  },
  {
    require: 'sudo',
    csrf: true,
    rateLimit: { points: 30, perSeconds: 60 },
  },
)

/**
 * POST /api/otter/caked/post — post a Caked card (contact / event / pricing
 * / announcement) to a Discord channel via the bot's `caked.message_post`
 * RPC verb.
 *
 * Body: `{ channelId: string, kind: 'contact'|'event'|'pricing'|'announcement', body?: string }`.
 * - `body` is required + ≤2000 chars for `announcement`. Ignored for the
 *   other kinds (canned cards owned by the bot's renderer).
 *
 * Gate: Caked manager+ of the `caked-up` business, or bot owner. We re-check
 * inside the handler (`withAuth` only gates on `'any'`/`'sudo'`/`'botOwner'`)
 * so the rank check stays in lockstep with the page-level affordance.
 *
 * CSRF + rate-limit are enforced by `withAuth({ csrf: true, rateLimit: ... })`.
 * Rate limit: 10/min/actor — same shape as the welcome preview route. Posting
 * to a Discord channel is observable to every user in that channel, so we
 * keep the quota tight.
 *
 * Audit: every attempt (success OR failure) writes `caked.posted` with the
 * relevant `kind` + `channelId` so the unified `/audit` tail picks it up.
 * Audit never blocks the response — same defensive pattern the rest of the
 * panel uses.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { withAuth } from '@/lib/auth/middleware'
import { callBot } from '@/lib/botrpc'
import { writeAudit } from '@/lib/audit'
import type { AccessMap } from '@/lib/auth/perms'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CAKED_SLUG = 'caked-up'

const KINDS = ['contact', 'event', 'pricing', 'announcement'] as const
type CakedKind = (typeof KINDS)[number]

const bodySchema = z
  .object({
    channelId: z.string().regex(/^\d{17,20}$/, 'channelId must be a Discord snowflake'),
    kind: z.enum(KINDS),
    body: z.string().max(2000).optional(),
  })
  .superRefine((val, ctx) => {
    if (val.kind === 'announcement') {
      const trimmed = val.body?.trim() ?? ''
      if (trimmed.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['body'],
          message: 'body is required for announcement',
        })
      }
    }
  })

function canPostCaked(access: AccessMap): boolean {
  if (access.botOwner) return true
  const rank = access.otter.businesses[CAKED_SLUG]
  return rank === 'manager' || rank === 'owner'
}

export const POST = withAuth(
  async (req: NextRequest, access) => {
    if (!canPostCaked(access)) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }

    let parsed: z.infer<typeof bodySchema>
    try {
      const raw = (await req.json()) as unknown
      parsed = bodySchema.parse(raw)
    } catch (err) {
      const details = err instanceof z.ZodError ? err.issues : 'invalid body'
      return NextResponse.json({ error: 'invalid', details }, { status: 400 })
    }

    const kind: CakedKind = parsed.kind

    // Strip body for non-announcement kinds — the bot ignores it anyway,
    // but keeping the payload tight makes the audit row easier to read.
    const params: { channelId: string; kind: CakedKind; body?: string } = {
      channelId: parsed.channelId,
      kind,
    }
    if (kind === 'announcement' && parsed.body) {
      params.body = parsed.body
    }

    const reply = await callBot<{
      messageId: string
      channelId: string
      kind: CakedKind
    }>('otter', 'caked.message_post', params)

    // Audit regardless of success — operators want to see attempts too.
    void writeAudit({
      bot: 'otter',
      actor: access.actor,
      viewing: access.viewing,
      action: 'caked.posted',
      targetType: 'channel',
      targetId: parsed.channelId,
      before: null,
      after: {
        kind,
        // Audit-log the announcement body (truncated to 500 chars by the
        // audit sanitiser) so an operator can later see exactly what was
        // posted. The other kinds are canned — no per-call payload to log.
        ...(kind === 'announcement' && parsed.body ? { body: parsed.body } : {}),
        messageId: reply.ok ? reply.data.messageId : null,
      },
      success: reply.ok,
      errorMessage: reply.ok ? undefined : reply.error,
    }).catch((auditErr: unknown) => {
      console.warn('[api/otter/caked/post] audit write failed', auditErr)
    })

    // Always 200 — the inline `reply.ok` flag carries success/failure so the
    // UI can render `timeout` / `channel-not-found` / etc. as friendly
    // notices instead of HTTP errors.
    return NextResponse.json({ reply })
  },
  {
    require: 'any',
    csrf: true,
    rateLimit: { points: 10, perSeconds: 60 },
  },
)

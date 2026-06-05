/**
 * PATCH  /api/otter/businesses/[slug]/buttons/[id] — edit one custom button.
 * DELETE /api/otter/businesses/[slug]/buttons/[id] — remove it.
 *
 * Gated to manager+ of the business (or bot owner) inside the handler; the
 * bot re-verifies rank AND that the button belongs to the slug's business via
 * the `business_buttons.update` / `business_buttons.delete` RPC verbs. CSRF +
 * audit per the other Otter writes. `enabled` arrives as a string from
 * `<ServerForm>`; we coerce to a real boolean before the RPC call.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { withAuth } from '@/lib/auth/middleware'
import { callBot } from '@/lib/botrpc'
import { writeAudit } from '@/lib/audit'
import type { AccessMap } from '@/lib/auth/perms'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const STYLE_VALUES = ['primary', 'secondary', 'success', 'danger'] as const
const TRANSPORT_ERRORS = new Set(['rpc-not-configured', 'timeout', 'redis-down', 'bad-reply'])

const boolish = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .transform((v) => (typeof v === 'boolean' ? v : v === 'true'))

const patchSchema = z
  .object({
    label: z.string().trim().min(1).max(80).optional(),
    emoji: z.string().trim().max(64).optional(),
    style: z.enum(STYLE_VALUES).optional(),
    url: z.string().trim().max(512).optional(),
    body: z.string().max(4000).optional(),
    enabled: boolish.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'at least one field is required' })

function canManageButtons(access: AccessMap, slug: string): boolean {
  if (access.botOwner) return true
  const rank = access.otter.businesses[slug]
  return rank === 'manager' || rank === 'owner'
}

function rpcStatus(error: string): number {
  return TRANSPORT_ERRORS.has(error) ? 502 : error === 'not-found' ? 404 : 400
}

type RouteCtx = { params: Promise<{ slug: string; id: string }> }

export const PATCH = withAuth<[RouteCtx]>(
  async (req: NextRequest, access, ctx) => {
    const { slug, id } = await ctx.params
    if (!canManageButtons(access, slug)) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }

    let parsed: z.infer<typeof patchSchema>
    try {
      parsed = patchSchema.parse(await req.json())
    } catch (err) {
      const details = err instanceof z.ZodError ? err.issues : 'invalid body'
      return NextResponse.json({ error: 'invalid', details }, { status: 400 })
    }

    const reply = await callBot('otter', 'business_buttons.update', {
      businessSlug: slug,
      id,
      ...parsed,
      actorUserId: access.actor.id,
    })

    void writeAudit({
      bot: 'otter',
      actor: access.actor,
      viewing: access.viewing,
      action: 'business_button.update',
      targetType: 'business_button',
      targetId: id,
      before: null,
      after: parsed,
      success: reply.ok,
      errorMessage: reply.ok ? undefined : reply.error,
    }).catch((e: unknown) => console.warn('[buttons PATCH] audit failed', e))

    if (!reply.ok) {
      return NextResponse.json({ error: reply.error }, { status: rpcStatus(reply.error) })
    }
    return NextResponse.json({ reply })
  },
  { require: 'any', csrf: true, rateLimit: { points: 60, perSeconds: 60 } },
)

export const DELETE = withAuth<[RouteCtx]>(
  async (_req: NextRequest, access, ctx) => {
    const { slug, id } = await ctx.params
    if (!canManageButtons(access, slug)) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }

    const reply = await callBot('otter', 'business_buttons.delete', {
      businessSlug: slug,
      id,
      actorUserId: access.actor.id,
    })

    void writeAudit({
      bot: 'otter',
      actor: access.actor,
      viewing: access.viewing,
      action: 'business_button.delete',
      targetType: 'business_button',
      targetId: id,
      before: null,
      after: null,
      success: reply.ok,
      errorMessage: reply.ok ? undefined : reply.error,
    }).catch((e: unknown) => console.warn('[buttons DELETE] audit failed', e))

    if (!reply.ok) {
      return NextResponse.json({ error: reply.error }, { status: rpcStatus(reply.error) })
    }
    return NextResponse.json({ ok: true })
  },
  { require: 'any', csrf: true, rateLimit: { points: 60, perSeconds: 60 } },
)

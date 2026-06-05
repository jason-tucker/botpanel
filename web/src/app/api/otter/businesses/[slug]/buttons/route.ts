/**
 * POST /api/otter/businesses/[slug]/buttons — create a custom command button.
 * PUT  /api/otter/businesses/[slug]/buttons — reorder buttons (`{orderedIds}`).
 *
 * Both gated to manager+ of the business (or bot owner) inside the handler;
 * `withAuth({require:'any'})` only enforces "logged in". The actual write
 * runs on the bot via the `business_buttons.*` RPC verbs (the bot owns the
 * table + cache), which re-verify manager+ rank server-side. CSRF +
 * rate-limit enforced by `withAuth`. Every attempt writes an audit row.
 *
 * RPC failures map to HTTP: configuration/transport errors → 502, everything
 * else (validation, forbidden, not-found) → 400, so `<ServerForm>`'s built-in
 * banner surfaces the bot's error code and the editor only refreshes on a
 * genuine success.
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

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .or(z.literal('').transform(() => undefined))

const createSchema = z.object({
  type: z.enum(['link', 'info']),
  label: z.string().trim().min(1).max(80),
  emoji: optionalText(64),
  style: z.enum(STYLE_VALUES).optional(),
  url: optionalText(512),
  body: z.string().max(4000).optional().or(z.literal('').transform(() => undefined)),
})

const reorderSchema = z.object({
  // ServerForm sends form fields as strings; accept a JSON-string array too.
  orderedIds: z.union([z.array(z.string()), z.string()]),
})

function canManageButtons(access: AccessMap, slug: string): boolean {
  if (access.botOwner) return true
  const rank = access.otter.businesses[slug]
  return rank === 'manager' || rank === 'owner'
}

function rpcStatus(error: string): number {
  return TRANSPORT_ERRORS.has(error) ? 502 : 400
}

type RouteCtx = { params: Promise<{ slug: string }> }

export const POST = withAuth<[RouteCtx]>(
  async (req: NextRequest, access, ctx) => {
    const { slug } = await ctx.params
    if (!canManageButtons(access, slug)) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }

    let parsed: z.infer<typeof createSchema>
    try {
      parsed = createSchema.parse(await req.json())
    } catch (err) {
      const details = err instanceof z.ZodError ? err.issues : 'invalid body'
      return NextResponse.json({ error: 'invalid', details }, { status: 400 })
    }

    const reply = await callBot('otter', 'business_buttons.create', {
      businessSlug: slug,
      type: parsed.type,
      label: parsed.label,
      emoji: parsed.emoji,
      style: parsed.style,
      url: parsed.url,
      body: parsed.body,
      actorUserId: access.actor.id,
    })

    void writeAudit({
      bot: 'otter',
      actor: access.actor,
      viewing: access.viewing,
      action: 'business_button.create',
      targetType: 'business_button',
      targetId: slug,
      before: null,
      after: { type: parsed.type, label: parsed.label },
      success: reply.ok,
      errorMessage: reply.ok ? undefined : reply.error,
    }).catch((e: unknown) => console.warn('[buttons POST] audit failed', e))

    if (!reply.ok) {
      return NextResponse.json({ error: reply.error }, { status: rpcStatus(reply.error) })
    }
    return NextResponse.json({ reply }, { status: 201 })
  },
  { require: 'any', csrf: true, rateLimit: { points: 30, perSeconds: 60 } },
)

export const PUT = withAuth<[RouteCtx]>(
  async (req: NextRequest, access, ctx) => {
    const { slug } = await ctx.params
    if (!canManageButtons(access, slug)) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }

    let orderedIds: string[]
    try {
      const parsed = reorderSchema.parse(await req.json())
      orderedIds = Array.isArray(parsed.orderedIds)
        ? parsed.orderedIds
        : (JSON.parse(parsed.orderedIds) as string[])
      if (!Array.isArray(orderedIds) || orderedIds.some((v) => typeof v !== 'string')) {
        throw new Error('orderedIds must be a string array')
      }
    } catch (err) {
      const details = err instanceof z.ZodError ? err.issues : 'invalid body'
      return NextResponse.json({ error: 'invalid', details }, { status: 400 })
    }

    const reply = await callBot('otter', 'business_buttons.reorder', {
      businessSlug: slug,
      orderedIds,
      actorUserId: access.actor.id,
    })

    void writeAudit({
      bot: 'otter',
      actor: access.actor,
      viewing: access.viewing,
      action: 'business_button.reorder',
      targetType: 'business_button',
      targetId: slug,
      before: null,
      after: { orderedIds },
      success: reply.ok,
      errorMessage: reply.ok ? undefined : reply.error,
    }).catch((e: unknown) => console.warn('[buttons PUT] audit failed', e))

    if (!reply.ok) {
      return NextResponse.json({ error: reply.error }, { status: rpcStatus(reply.error) })
    }
    return NextResponse.json({ reply })
  },
  { require: 'any', csrf: true, rateLimit: { points: 30, perSeconds: 60 } },
)

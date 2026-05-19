/**
 * POST /api/otter/report — file an OtterBot report from the panel.
 *
 * Mirrors the `/report` slash modal exactly: the bot owns the DM-the-owner
 * + GitHub-issue side, the panel only adds an auth boundary, a tight
 * rate-limit (real owner DMs at stake), CSRF, and an audit row.
 *
 * The audit row records only `{title, type}` — the description goes to the
 * owner DM and we don't want full report text replicated into the audit
 * log next to every other state-changing edit.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { withAuth } from '@/lib/auth/middleware'
import { callBot } from '@/lib/botrpc'
import { writeAudit } from '@/lib/audit'
import { notifyAll } from '@/lib/push/dispatch'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Body = {
  title?: unknown
  type?: unknown
  description?: unknown
  steps?: unknown
}

function validate(body: Body): { title: string; type: string; description: string; steps?: string } | { error: string } {
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  const type = typeof body.type === 'string' ? body.type.trim() : ''
  const description = typeof body.description === 'string' ? body.description.trim() : ''
  const steps = typeof body.steps === 'string' ? body.steps.trim() : ''
  if (title.length < 5 || title.length > 200) return { error: 'invalid-title' }
  if (type.length === 0 || type.length > 20) return { error: 'invalid-type' }
  if (description.length < 10 || description.length > 2000) return { error: 'invalid-description' }
  if (steps.length > 1000) return { error: 'invalid-steps' }
  return { title, type, description, steps: steps || undefined }
}

export const POST = withAuth(
  async (req: NextRequest, access) => {
    let body: Body
    try {
      body = (await req.json()) as Body
    } catch {
      return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
    }
    const parsed = validate(body)
    if ('error' in parsed) {
      await writeAudit({
        bot: 'otter',
        actor: access.actor,
        viewing: access.viewing,
        action: 'report.submitted',
        targetType: 'report',
        targetId: access.actor.id,
        before: null,
        after: null,
        success: false,
        errorMessage: parsed.error,
      }).catch(() => {})
      return NextResponse.json({ error: parsed.error }, { status: 400 })
    }

    const reply = await callBot<{ sessionKey: string; ownerNotified: boolean }>(
      'otter',
      'report.submit',
      {
        userId: access.actor.id,
        title: parsed.title,
        type: parsed.type,
        description: parsed.description,
        steps: parsed.steps,
      },
    )

    if (!reply.ok) {
      await writeAudit({
        bot: 'otter',
        actor: access.actor,
        viewing: access.viewing,
        action: 'report.submitted',
        targetType: 'report',
        targetId: access.actor.id,
        before: null,
        after: { title: parsed.title, type: parsed.type },
        success: false,
        errorMessage: reply.error,
      }).catch(() => {})
      const status =
        reply.error === 'timeout' || reply.error === 'rpc-not-configured' ? 503 : 400
      return NextResponse.json({ error: reply.error, details: reply.details }, { status })
    }

    await writeAudit({
      bot: 'otter',
      actor: access.actor,
      viewing: access.viewing,
      action: 'report.submitted',
      targetType: 'report',
      targetId: access.actor.id,
      before: null,
      after: { title: parsed.title, type: parsed.type },
      success: true,
    }).catch(() => {})

    // Fire-and-forget Web Push to subscribers so an operator with the
    // panel closed still gets paged on a new report. `void` so a
    // push-service hiccup never fails the underlying bot-side write.
    void notifyAll(
      `New report (otter): ${parsed.type}`,
      `${parsed.title} — by @${access.actor.username}`,
      '/sudo',
    )

    return NextResponse.json({ ok: true, data: reply.data })
  },
  {
    require: 'any',
    csrf: true,
    rateLimit: { points: 3, perSeconds: 600 },
  },
)

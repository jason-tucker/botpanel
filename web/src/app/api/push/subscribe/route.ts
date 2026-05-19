/**
 * POST   /api/push/subscribe — register a Web Push subscription
 * DELETE /api/push/subscribe — drop a Web Push subscription
 *
 * Body shape mirrors the browser's `PushSubscription.toJSON()`:
 *   POST   { endpoint: string, keys: { p256dh: string, auth: string } }
 *   DELETE { endpoint: string }
 *
 * Both gated to `sudo` — sudo includes bot-owner, so any operator who
 * could meaningfully act on a staff-approval or report notification
 * can subscribe. Members can't (they wouldn't have anything to do
 * with the notification anyway).
 *
 * Upsert behaviour: re-subscribing from the same browser (same
 * endpoint) refreshes the keys + `last_seen_at` but keeps the
 * original `subscribed_at`. The (endpoint) unique index drives the
 * conflict target — endpoints are globally unique per the Web Push
 * spec, so we don't need (user_id, endpoint).
 */
import { NextResponse, type NextRequest } from 'next/server'
import { withAuth } from '@/lib/auth/middleware'
import { writeAudit } from '@/lib/audit'
import { squishyDb } from '@/lib/db/squishy'
import { pushSubscriptions } from '@/lib/db/schema/panel/pushSubscriptions'
import {
  ensurePushSubscriptionsTable,
  deleteSubscriptionByEndpoint,
} from '@/lib/push/dispatch'
import { env } from '@/lib/env'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type SubscribeBody = {
  endpoint?: unknown
  keys?: { p256dh?: unknown; auth?: unknown }
}

function isHttpsUrl(v: unknown): v is string {
  return typeof v === 'string' && /^https:\/\/[^\s]+$/i.test(v) && v.length < 2048
}

function isB64UrlIsh(v: unknown, minLen: number, maxLen: number): v is string {
  // The browser hands us URL-safe base64. We don't strictly validate
  // the bytes (web-push will reject malformed keys at send time) —
  // just length + charset so a typo'd field doesn't poison the table.
  return (
    typeof v === 'string' &&
    v.length >= minLen &&
    v.length <= maxLen &&
    /^[A-Za-z0-9_\-=]+$/.test(v)
  )
}

export const POST = withAuth(
  async (req: NextRequest, access) => {
    if (!env.VAPID_PUBLIC || !env.VAPID_PRIVATE) {
      return NextResponse.json(
        { error: 'push-not-configured', message: 'Operator has not set VAPID_PUBLIC / VAPID_PRIVATE.' },
        { status: 503 },
      )
    }

    let body: SubscribeBody
    try {
      body = (await req.json()) as SubscribeBody
    } catch {
      return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
    }

    const endpoint = body.endpoint
    const p256dh = body.keys?.p256dh
    const auth = body.keys?.auth

    if (!isHttpsUrl(endpoint)) {
      await writeAudit({
        bot: 'squishy',
        actor: access.actor,
        viewing: access.viewing,
        action: 'push.subscribed',
        targetType: 'push_subscription',
        targetId: null,
        before: null,
        after: null,
        success: false,
        errorMessage: 'invalid-endpoint',
      }).catch(() => {})
      return NextResponse.json({ error: 'invalid-endpoint' }, { status: 400 })
    }
    // p256dh public key — 65 bytes raw → 87-88 chars b64url.
    if (!isB64UrlIsh(p256dh, 80, 200)) {
      await writeAudit({
        bot: 'squishy',
        actor: access.actor,
        viewing: access.viewing,
        action: 'push.subscribed',
        targetType: 'push_subscription',
        targetId: null,
        before: null,
        after: null,
        success: false,
        errorMessage: 'invalid-p256dh',
      }).catch(() => {})
      return NextResponse.json({ error: 'invalid-p256dh' }, { status: 400 })
    }
    // auth secret — 16 bytes raw → ~22-24 chars b64url.
    if (!isB64UrlIsh(auth, 16, 64)) {
      await writeAudit({
        bot: 'squishy',
        actor: access.actor,
        viewing: access.viewing,
        action: 'push.subscribed',
        targetType: 'push_subscription',
        targetId: null,
        before: null,
        after: null,
        success: false,
        errorMessage: 'invalid-auth',
      }).catch(() => {})
      return NextResponse.json({ error: 'invalid-auth' }, { status: 400 })
    }

    await ensurePushSubscriptionsTable()

    try {
      await squishyDb
        .insert(pushSubscriptions)
        .values({
          userId: access.actor.id,
          endpoint,
          p256dhKey: p256dh,
          authKey: auth,
        })
        .onConflictDoUpdate({
          target: pushSubscriptions.endpoint,
          set: {
            userId: access.actor.id,
            p256dhKey: p256dh,
            authKey: auth,
            lastSeenAt: new Date(),
          },
        })
    } catch (err) {
      console.warn('[push] subscribe insert failed', err)
      await writeAudit({
        bot: 'squishy',
        actor: access.actor,
        viewing: access.viewing,
        action: 'push.subscribed',
        targetType: 'push_subscription',
        targetId: null,
        before: null,
        after: null,
        success: false,
        errorMessage: 'db-error',
      }).catch(() => {})
      return NextResponse.json({ error: 'db-error' }, { status: 500 })
    }

    await writeAudit({
      bot: 'squishy',
      actor: access.actor,
      viewing: access.viewing,
      action: 'push.subscribed',
      targetType: 'push_subscription',
      // Endpoint URLs are long and contain a per-browser secret. We
      // record the host + the last 12 chars only so the audit row is
      // grep-able without leaking the unguessable bit publicly.
      targetId: redactEndpoint(endpoint),
      before: null,
      after: null,
      success: true,
    }).catch(() => {})

    return NextResponse.json({ ok: true })
  },
  {
    require: 'sudo',
    csrf: true,
    // Re-subscribing on every page load shouldn't be possible (the
    // browser only fires once per permission grant), but a tight cap
    // keeps an abusive client from filling the table.
    rateLimit: { points: 10, perSeconds: 60 },
  },
)

export const DELETE = withAuth(
  async (req: NextRequest, access) => {
    let body: { endpoint?: unknown }
    try {
      body = (await req.json()) as { endpoint?: unknown }
    } catch {
      return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
    }
    const endpoint = body.endpoint
    if (!isHttpsUrl(endpoint)) {
      return NextResponse.json({ error: 'invalid-endpoint' }, { status: 400 })
    }

    const removed = await deleteSubscriptionByEndpoint(endpoint)

    await writeAudit({
      bot: 'squishy',
      actor: access.actor,
      viewing: access.viewing,
      action: 'push.unsubscribed',
      targetType: 'push_subscription',
      targetId: redactEndpoint(endpoint),
      before: null,
      after: null,
      success: removed,
      errorMessage: removed ? null : 'not-found',
    }).catch(() => {})

    return NextResponse.json({ ok: true, removed })
  },
  {
    require: 'sudo',
    csrf: true,
    rateLimit: { points: 10, perSeconds: 60 },
  },
)

function redactEndpoint(endpoint: string): string {
  try {
    const u = new URL(endpoint)
    return `${u.host}/…${endpoint.slice(-12)}`
  } catch {
    return endpoint.slice(0, 32) + '…'
  }
}

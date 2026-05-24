/**
 * PUT  /api/squishy/settings/[key] — upsert a `bot_settings` row.
 * DELETE /api/squishy/settings/[key] — delete a `bot_settings` row.
 *
 * Gate: `access.squishy.sudo || access.botOwner` (handled by `withAuth`'s
 * `require: 'sudo'` — same semantics as the read route).
 *
 * Validation:
 *  - `[key]` must match `/^[a-z][a-z0-9._]+$/i` and be < 128 chars. This is
 *    the namespace shape the bot already enforces by convention (look at
 *    `squishybot/src/services/settings.ts` setters — every caller passes a
 *    dotted lowercase key). We don't trust the path segment from the URL,
 *    so we re-validate here even though the bot expects the same shape.
 *  - PUT body `{ value: string }` — non-empty, < 4096 chars after trim. We
 *    keep the original spacing inside the value (trim only for the empty
 *    check) so callers can intentionally store leading/trailing whitespace
 *    if they want; we just refuse "" or all-whitespace strings.
 *
 * Audit: every success and every validation failure writes via `writeAudit`.
 * `writeAudit` routes setting writes to the bot's existing `setting_changes`
 * table — the schema mapping lives in `@/lib/audit` (agent T's surface).
 *
 * Idempotent upsert: `ON CONFLICT (key) DO UPDATE SET …` keeps PUT
 * semantically PUT — the same body produces the same row regardless of
 * whether one exists.
 *
 * Rate limit: 60 req/min/actor — covers a sudo viewer mass-editing a
 * namespace without giving someone a write-loop foothold.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { withAuth } from '@/lib/auth/middleware'
import { writeAudit } from '@/lib/audit'
import { squishyDb, squishySchema } from '@/lib/db/squishy'
import { publishInvalidate } from '@/lib/events/invalidate'
import { validateNumericSetting } from '@/lib/squishy/settings-registry'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const KEY_RE = /^[a-z][a-z0-9._]+$/i
const KEY_MAX = 128
const VALUE_MAX = 4096

type RouteCtx = { params: Promise<{ key: string }> }

function badKey(key: string): string | null {
  if (!key) return 'key required'
  if (key.length >= KEY_MAX) return `key must be < ${KEY_MAX} chars`
  if (!KEY_RE.test(key)) return 'key must match /^[a-z][a-z0-9._]+$/i'
  return null
}

async function readExistingValue(key: string): Promise<string | null> {
  try {
    const rows = await squishyDb
      .select({ value: squishySchema.botSettings.value })
      .from(squishySchema.botSettings)
      .where(eq(squishySchema.botSettings.key, key))
      .limit(1)
    return rows[0]?.value ?? null
  } catch (err) {
    console.warn('[squishy/settings PUT] read-before-write failed', err)
    return null
  }
}

export const PUT = withAuth(
  async (req: NextRequest, access, ctx: RouteCtx) => {
    const { key } = await ctx.params
    const actor = access.actor.id

    const keyErr = badKey(key)
    if (keyErr) {
      await writeAudit({
        bot: 'squishy',
        action: 'setting.changed',
        targetType: 'bot_settings',
        targetId: key,
        actor: access.actor, viewing: access.viewing,
        before: null,
        after: null,
        success: false,
        errorMessage: keyErr,
      }).catch(() => {})
      return NextResponse.json({ error: keyErr }, { status: 400 })
    }

    let body: unknown
    try {
      body = await req.json()
    } catch {
      await writeAudit({
        bot: 'squishy',
        action: 'setting.changed',
        targetType: 'bot_settings',
        targetId: key,
        actor: access.actor, viewing: access.viewing,
        before: null,
        after: null,
        success: false,
        errorMessage: 'invalid-json',
      }).catch(() => {})
      return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
    }

    const value = (body as { value?: unknown } | null)?.value
    if (typeof value !== 'string') {
      await writeAudit({
        bot: 'squishy',
        action: 'setting.changed',
        targetType: 'bot_settings',
        targetId: key,
        actor: access.actor, viewing: access.viewing,
        before: null,
        after: null,
        success: false,
        errorMessage: 'value must be a string',
      }).catch(() => {})
      return NextResponse.json({ error: 'value must be a string' }, { status: 400 })
    }
    if (value.trim().length === 0) {
      await writeAudit({
        bot: 'squishy',
        action: 'setting.changed',
        targetType: 'bot_settings',
        targetId: key,
        actor: access.actor, viewing: access.viewing,
        before: null,
        after: null,
        success: false,
        errorMessage: 'value must be non-empty',
      }).catch(() => {})
      return NextResponse.json({ error: 'value must be non-empty' }, { status: 400 })
    }
    if (value.length > VALUE_MAX) {
      await writeAudit({
        bot: 'squishy',
        action: 'setting.changed',
        targetType: 'bot_settings',
        targetId: key,
        actor: access.actor, viewing: access.viewing,
        before: null,
        after: null,
        success: false,
        errorMessage: `value must be <= ${VALUE_MAX} chars`,
      }).catch(() => {})
      return NextResponse.json(
        { errorMessage: `value must be <= ${VALUE_MAX} chars` },
        { status: 400 },
      )
    }

    // Per-key numeric bounds (#237). Mirrors squishybot#130's NUMERIC_SETTINGS
    // — see `@/lib/squishy/settings-registry`. No-op for non-numeric keys.
    const numericErr = validateNumericSetting(key, value)
    if (numericErr) {
      await writeAudit({
        bot: 'squishy',
        action: 'setting.changed',
        targetType: 'bot_settings',
        targetId: key,
        actor: access.actor, viewing: access.viewing,
        before: null,
        after: null,
        success: false,
        errorMessage: numericErr,
      }).catch(() => {})
      return NextResponse.json({ error: numericErr }, { status: 400 })
    }

    const before = await readExistingValue(key)

    try {
      await squishyDb
        .insert(squishySchema.botSettings)
        .values({
          key,
          value,
          updatedByDiscordId: actor,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: squishySchema.botSettings.key,
          set: {
            value,
            updatedByDiscordId: actor,
            updatedAt: new Date(),
          },
        })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown'
      console.error('[squishy/settings PUT] DB write failed', err)
      await writeAudit({
        bot: 'squishy',
        action: 'setting.changed',
        targetType: 'bot_settings',
        targetId: key,
        actor: access.actor, viewing: access.viewing,
        before,
        after: value,
        success: false,
        errorMessage: msg,
      }).catch(() => {})
      return NextResponse.json({ error: 'db-write-failed' }, { status: 503 })
    }

    await writeAudit({
      bot: 'squishy',
      action: 'setting.changed',
      targetType: 'bot_settings',
      targetId: key,
      actor: access.actor, viewing: access.viewing,
      before,
      after: value,
      success: true,
    }).catch((err) => {
      console.warn('[squishy/settings PUT] audit write failed (write succeeded)', err)
    })

    publishInvalidate('squishy', { table: 'bot_settings', key })

    return NextResponse.json({ success: true, key, value })
  },
  {
    require: 'sudo',
    csrf: true,
    rateLimit: { points: 60, perSeconds: 60 },
  },
)

export const DELETE = withAuth(
  async (_req: NextRequest, access, ctx: RouteCtx) => {
    const { key } = await ctx.params
    const actor = access.actor.id

    const keyErr = badKey(key)
    if (keyErr) {
      await writeAudit({
        bot: 'squishy',
        action: 'setting.cleared',
        targetType: 'bot_settings',
        targetId: key,
        actor: access.actor, viewing: access.viewing,
        before: null,
        after: null,
        success: false,
        errorMessage: keyErr,
      }).catch(() => {})
      return NextResponse.json({ error: keyErr }, { status: 400 })
    }

    const before = await readExistingValue(key)
    if (before === null) {
      // Idempotent — already gone is success. Audit it as a no-op so an
      // operator can still trace the click in the timeline if they need to.
      await writeAudit({
        bot: 'squishy',
        action: 'setting.cleared',
        targetType: 'bot_settings',
        targetId: key,
        actor: access.actor, viewing: access.viewing,
        before: null,
        after: null,
        success: true,
        errorMessage: 'not-found',
      }).catch(() => {})
      return NextResponse.json({ success: true, key, cleared: false })
    }

    try {
      await squishyDb
        .delete(squishySchema.botSettings)
        .where(eq(squishySchema.botSettings.key, key))
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown'
      console.error('[squishy/settings DELETE] DB write failed', err)
      await writeAudit({
        bot: 'squishy',
        action: 'setting.cleared',
        targetType: 'bot_settings',
        targetId: key,
        actor: access.actor, viewing: access.viewing,
        before,
        after: null,
        success: false,
        errorMessage: msg,
      }).catch(() => {})
      return NextResponse.json({ error: 'db-write-failed' }, { status: 503 })
    }

    await writeAudit({
      bot: 'squishy',
      action: 'setting.cleared',
      targetType: 'bot_settings',
      targetId: key,
      actor: access.actor, viewing: access.viewing,
      before,
      after: null,
      success: true,
    }).catch((err) => {
      console.warn('[squishy/settings DELETE] audit write failed (delete succeeded)', err)
    })

    publishInvalidate('squishy', { table: 'bot_settings', key })

    return NextResponse.json({ success: true, key, cleared: true })
  },
  {
    require: 'sudo',
    csrf: true,
    rateLimit: { points: 60, perSeconds: 60 },
  },
)

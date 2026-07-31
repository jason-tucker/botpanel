/**
 * POST /api/squishy/stats/settings — toggle the Activity Stats feature flag.
 *
 * Body: `{ enabled: boolean }` (zod). Gate: sudo (`squishy.sudo || botOwner`
 * via `withAuth({require:'sudo'})` — mirrors `api/squishy/settings/[key]/
 * route.ts`'s PUT structure exactly: audit on EVERY branch including
 * validation/DB failures, `publishInvalidate` after success only.
 *
 * Upserts `bot_settings.feature.activity_stats`. On the FIRST enable (no
 * `stats.enabled_at` row yet) also stamps `stats.enabled_at` = now (ISO) —
 * that timestamp is the shared watermark the bot's backfill cursor and this
 * page's "tracking since" line both key off, so it's write-once: disabling
 * and re-enabling later does NOT reset it.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { withAuth } from '@/lib/auth/middleware'
import { writeAudit } from '@/lib/audit'
import { squishyDb, squishySchema } from '@/lib/db/squishy'
import { publishInvalidate } from '@/lib/events/invalidate'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const FLAG_KEY = 'feature.activity_stats'
const ENABLED_AT_KEY = 'stats.enabled_at'

const bodySchema = z.object({ enabled: z.boolean() })

/**
 * `<ServerForm>` always posts FormData-derived JSON, so every `<input>`
 * value (including our `<input type="hidden" name="enabled" value="true">`
 * toggles) arrives as the STRING `"true"`/`"false"`, not a real boolean.
 * Coerce before validation rather than loosen the schema — same pattern as
 * `coerceProfilePatch` in `api/squishy/profiles/[id]/route.ts`.
 */
function coerceBody(body: unknown): unknown {
  if (!body || typeof body !== 'object') return body
  const src = body as Record<string, unknown>
  if (typeof src.enabled !== 'string') return src
  return { ...src, enabled: src.enabled === 'true' }
}

async function readSetting(key: string): Promise<string | null> {
  try {
    const rows = await squishyDb
      .select({ value: squishySchema.botSettings.value })
      .from(squishySchema.botSettings)
      .where(eq(squishySchema.botSettings.key, key))
      .limit(1)
    return rows[0]?.value ?? null
  } catch (err) {
    console.warn('[squishy/stats/settings POST] read-before-write failed', err)
    return null
  }
}

async function upsertSetting(key: string, value: string, actorId: string): Promise<void> {
  await squishyDb
    .insert(squishySchema.botSettings)
    .values({ key, value, updatedByDiscordId: actorId, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: squishySchema.botSettings.key,
      set: { value, updatedByDiscordId: actorId, updatedAt: new Date() },
    })
}

export const POST = withAuth(
  async (req: NextRequest, access) => {
    const actor = access.actor.id

    let body: unknown
    try {
      body = await req.json()
    } catch {
      await writeAudit({
        bot: 'squishy',
        action: 'setting.changed',
        targetType: 'bot_settings',
        targetId: FLAG_KEY,
        actor: access.actor, viewing: access.viewing,
        before: null,
        after: null,
        success: false,
        errorMessage: 'invalid-json',
      }).catch(() => {})
      return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
    }

    const parsed = bodySchema.safeParse(coerceBody(body))
    if (!parsed.success) {
      await writeAudit({
        bot: 'squishy',
        action: 'setting.changed',
        targetType: 'bot_settings',
        targetId: FLAG_KEY,
        actor: access.actor, viewing: access.viewing,
        before: null,
        after: null,
        success: false,
        errorMessage: 'validation-failed',
      }).catch(() => {})
      return NextResponse.json({ error: 'invalid body — expected { enabled: boolean }' }, { status: 400 })
    }

    const { enabled } = parsed.data
    const before = await readSetting(FLAG_KEY)
    const afterValue = enabled ? 'true' : 'false'

    try {
      await upsertSetting(FLAG_KEY, afterValue, actor)

      // Stamp stats.enabled_at exactly once — the FIRST enable only. This is
      // deliberately NOT audited on its own (bot-side convention: `audit:
      // false` for the same key) since the flag flip above is the
      // user-meaningful audit event; the timestamp is a derived artifact.
      if (enabled) {
        const existingEnabledAt = await readSetting(ENABLED_AT_KEY)
        if (!existingEnabledAt) {
          await upsertSetting(ENABLED_AT_KEY, new Date().toISOString(), actor)
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown'
      console.error('[squishy/stats/settings POST] DB write failed', err)
      await writeAudit({
        bot: 'squishy',
        action: 'setting.changed',
        targetType: 'bot_settings',
        targetId: FLAG_KEY,
        actor: access.actor, viewing: access.viewing,
        before,
        after: afterValue,
        success: false,
        errorMessage: msg,
      }).catch(() => {})
      return NextResponse.json({ error: 'db-write-failed' }, { status: 503 })
    }

    await writeAudit({
      bot: 'squishy',
      action: 'setting.changed',
      targetType: 'bot_settings',
      targetId: FLAG_KEY,
      actor: access.actor, viewing: access.viewing,
      before,
      after: afterValue,
      success: true,
    }).catch((err) => {
      console.warn('[squishy/stats/settings POST] audit write failed (write succeeded)', err)
    })

    publishInvalidate('squishy', { table: 'bot_settings', key: FLAG_KEY })

    return NextResponse.json({ success: true, enabled })
  },
  {
    require: 'sudo',
    csrf: true,
    rateLimit: { points: 10, perSeconds: 60 },
  },
)

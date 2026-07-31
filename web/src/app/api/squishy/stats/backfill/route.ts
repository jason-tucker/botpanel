/**
 * POST /api/squishy/stats/backfill — two mutually exclusive request shapes:
 *
 *  - `{ enabled: boolean }` — toggles `bot_settings.stats.backfill.enabled`
 *    (pause/resume the history backfill loop). Same audit + invalidate
 *    shape as `POST .../stats/settings`.
 *  - `{ reset: true }` — WIPES backfilled history: deletes every
 *    `activity_backfill_progress` row AND (when `stats.enabled_at` is set)
 *    every `activity_message_stats` / `activity_emoji_stats` row with
 *    `bucket < enabled_at` — those rows are backfill-sourced by
 *    construction, since live tracking never writes before the enable
 *    watermark. Runs in one transaction so a reset can't partially apply.
 *    Mirrors the bot's own `resetBackfillProgress()` so panel and bot agree
 *    on what counts as "backfilled". `publishInvalidate` is skipped for
 *    this branch — it doesn't touch a row the bot caches, just history
 *    tables it never holds in memory.
 *
 * Gate: sudo. CSRF + rate-limited. Audit on every branch (including
 * validation/DB failures) — mirrors `api/squishy/settings/[key]/route.ts`.
 * Reset audits under `targetId: 'stats.backfill.progress'` (only
 * `setting.changed`/`setting.cleared` persist into `setting_changes` —
 * see `@/lib/audit`), `before` = pre-reset scanned counts, `after` = 'reset'.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { eq, lt } from 'drizzle-orm'
import { z } from 'zod'
import { withAuth } from '@/lib/auth/middleware'
import { writeAudit } from '@/lib/audit'
import { squishyDb, squishySchema } from '@/lib/db/squishy'
import { publishInvalidate } from '@/lib/events/invalidate'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const TOGGLE_KEY = 'stats.backfill.enabled'
const ENABLED_AT_KEY = 'stats.enabled_at'
const RESET_TARGET_ID = 'stats.backfill.progress'

const bodySchema = z.union([
  z.object({ enabled: z.boolean() }),
  z.object({ reset: z.literal(true) }),
])

/**
 * `<ServerForm>` posts FormData-derived JSON, so hidden-input toggles
 * (`<input type="hidden" name="enabled" value="true">` /
 * `name="reset" value="true"`) arrive as the STRING `"true"`, not a real
 * boolean/literal. Coerce before validation — same pattern as
 * `coerceProfilePatch` in `api/squishy/profiles/[id]/route.ts`.
 */
function coerceBody(body: unknown): unknown {
  if (!body || typeof body !== 'object') return body
  const src = body as Record<string, unknown>
  const out: Record<string, unknown> = { ...src }
  if (typeof out.enabled === 'string') out.enabled = out.enabled === 'true'
  if (typeof out.reset === 'string') out.reset = out.reset === 'true'
  return out
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
    console.warn('[squishy/stats/backfill POST] read-before-write failed', err)
    return null
  }
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
        targetId: TOGGLE_KEY,
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
        targetId: TOGGLE_KEY,
        actor: access.actor, viewing: access.viewing,
        before: null,
        after: null,
        success: false,
        errorMessage: 'validation-failed',
      }).catch(() => {})
      return NextResponse.json(
        { error: 'invalid body — expected { enabled: boolean } or { reset: true }' },
        { status: 400 },
      )
    }

    // ── Reset branch — clears backfilled history + progress ────────────
    if ('reset' in parsed.data) {
      const enabledAtRaw = await readSetting(ENABLED_AT_KEY)
      const enabledAt = enabledAtRaw ? new Date(enabledAtRaw) : null
      const enabledAtValid = enabledAt && !Number.isNaN(enabledAt.getTime()) ? enabledAt : null

      let before: { progressRows: number; messagesScanned: number } = { progressRows: 0, messagesScanned: 0 }
      try {
        const progressRows = await squishyDb.select().from(squishySchema.activityBackfillProgress)
        before = {
          progressRows: progressRows.length,
          messagesScanned: progressRows.reduce((sum, r) => sum + (r.messagesScanned ?? 0), 0),
        }
      } catch (err) {
        console.warn('[squishy/stats/backfill POST] pre-reset read failed (continuing)', err)
      }

      try {
        await squishyDb.transaction(async (tx) => {
          await tx.delete(squishySchema.activityBackfillProgress)
          if (enabledAtValid) {
            await tx
              .delete(squishySchema.activityMessageStats)
              .where(lt(squishySchema.activityMessageStats.bucket, enabledAtValid))
            await tx
              .delete(squishySchema.activityEmojiStats)
              .where(lt(squishySchema.activityEmojiStats.bucket, enabledAtValid))
          }
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown'
        console.error('[squishy/stats/backfill POST] reset failed', err)
        await writeAudit({
          bot: 'squishy',
          action: 'setting.changed',
          targetType: 'bot_settings',
          targetId: RESET_TARGET_ID,
          actor: access.actor, viewing: access.viewing,
          before,
          after: 'reset',
          success: false,
          errorMessage: msg,
        }).catch(() => {})
        return NextResponse.json({ error: 'db-write-failed' }, { status: 503 })
      }

      await writeAudit({
        bot: 'squishy',
        action: 'setting.changed',
        targetType: 'bot_settings',
        targetId: RESET_TARGET_ID,
        actor: access.actor, viewing: access.viewing,
        before,
        after: 'reset',
        success: true,
      }).catch((err) => {
        console.warn('[squishy/stats/backfill POST] audit write failed (reset succeeded)', err)
      })

      return NextResponse.json({ success: true, reset: true, before })
    }

    // ── Toggle branch — pause/resume the backfill loop ─────────────────
    const { enabled } = parsed.data
    const before = await readSetting(TOGGLE_KEY)
    const afterValue = enabled ? 'true' : 'false'

    try {
      await squishyDb
        .insert(squishySchema.botSettings)
        .values({ key: TOGGLE_KEY, value: afterValue, updatedByDiscordId: actor, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: squishySchema.botSettings.key,
          set: { value: afterValue, updatedByDiscordId: actor, updatedAt: new Date() },
        })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown'
      console.error('[squishy/stats/backfill POST] DB write failed', err)
      await writeAudit({
        bot: 'squishy',
        action: 'setting.changed',
        targetType: 'bot_settings',
        targetId: TOGGLE_KEY,
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
      targetId: TOGGLE_KEY,
      actor: access.actor, viewing: access.viewing,
      before,
      after: afterValue,
      success: true,
    }).catch((err) => {
      console.warn('[squishy/stats/backfill POST] audit write failed (write succeeded)', err)
    })

    publishInvalidate('squishy', { table: 'bot_settings', key: TOGGLE_KEY })

    return NextResponse.json({ success: true, enabled })
  },
  {
    require: 'sudo',
    csrf: true,
    rateLimit: { points: 10, perSeconds: 60 },
  },
)

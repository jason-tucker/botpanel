/**
 * POST /api/squishy/hubs — DB-only hub registry CRUD: insert a new row.
 *
 * Body: `{ voiceChannelId: string, label?: string, position?: number,
 *          categoryId?: string }` (JSON only via `<ServerForm>`).
 *
 * What this route IS:
 *  - A direct INSERT into Squishy's `hub_channels` table.
 *  - Followed by a `hub.refresh_cache` RPC call so the bot's
 *    `isHubChannelCached` hot path picks up the new row immediately.
 *
 * What this route is NOT:
 *  - It does NOT create a voice channel on Discord. The caller is
 *    expected to either (a) point at an existing voice channel they
 *    already created in the Discord client, or (b) be migrating an
 *    existing hub from another source. Discord-side channel creation
 *    moves through a dedicated `hub.create` verb in a later wave.
 *
 * Defaults:
 *  - `categoryId` — when omitted, we look up `channel.auto_voice_category`
 *    from Squishy's `bot_settings` table. If that's also unset we refuse
 *    with `categoryId-unset` since the column is NOT NULL.
 *  - `label` — Drizzle column default `'➕ Create Voice'` kicks in.
 *  - `position` — defaults to 0 (top of the voice category).
 *
 * Gating: sudo via `withAuth({require:'sudo'})`. CSRF + 30/min rate
 * limit. Audited `hub.added` on success and on every validation failure.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { withAuth } from '@/lib/auth/middleware'
import { writeAudit } from '@/lib/audit'
import { squishyDb, squishySchema } from '@/lib/db/squishy'
import { callBot } from '@/lib/botrpc'
import { env } from '@/lib/env'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SNOWFLAKE_RE = /^\d{15,25}$/
const MAX_LABEL_LEN = 100

export const POST = withAuth(
  async (req: NextRequest, access) => {
    let body: { voiceChannelId?: unknown; label?: unknown; position?: unknown; categoryId?: unknown }
    try {
      body = (await req.json()) ?? {}
    } catch {
      await writeAudit({
        bot: 'squishy',
        action: 'hub.added',
        actor: access.actor,
        viewing: access.viewing,
        targetType: 'hub_channels',
        success: false,
        errorMessage: 'invalid-json',
      }).catch(() => {})
      return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
    }

    const voiceChannelId =
      typeof body.voiceChannelId === 'string' ? body.voiceChannelId.trim() : ''
    if (!SNOWFLAKE_RE.test(voiceChannelId)) {
      await writeAudit({
        bot: 'squishy',
        action: 'hub.added',
        actor: access.actor,
        viewing: access.viewing,
        targetType: 'hub_channels',
        targetId: voiceChannelId,
        success: false,
        errorMessage: 'invalid-voiceChannelId',
      }).catch(() => {})
      return NextResponse.json(
        { error: 'voiceChannelId must be a Discord snowflake (15-25 digits)' },
        { status: 400 },
      )
    }

    let label: string | undefined
    if (body.label !== undefined && body.label !== null && body.label !== '') {
      if (typeof body.label !== 'string') {
        return NextResponse.json({ error: 'label must be a string' }, { status: 400 })
      }
      const trimmed = body.label.trim()
      if (trimmed.length === 0 || trimmed.length > MAX_LABEL_LEN) {
        return NextResponse.json(
          { error: `label must be 1-${MAX_LABEL_LEN} chars` },
          { status: 400 },
        )
      }
      label = trimmed
    }

    let position = 0
    if (body.position !== undefined && body.position !== null && body.position !== '') {
      // <input type="number"> sends a string in JSON; coerce.
      const n = typeof body.position === 'number' ? body.position : Number(body.position)
      if (!Number.isFinite(n) || !Number.isInteger(n)) {
        return NextResponse.json({ error: 'position must be an integer' }, { status: 400 })
      }
      position = n
    }

    let categoryId: string | null = null
    if (body.categoryId !== undefined && body.categoryId !== null && body.categoryId !== '') {
      if (typeof body.categoryId !== 'string') {
        return NextResponse.json({ error: 'categoryId must be a string' }, { status: 400 })
      }
      const trimmed = body.categoryId.trim()
      if (!SNOWFLAKE_RE.test(trimmed)) {
        return NextResponse.json(
          { error: 'categoryId must be a Discord snowflake (15-25 digits)' },
          { status: 400 },
        )
      }
      categoryId = trimmed
    } else {
      // Fall back to the bot's saved auto-voice category setting.
      try {
        const rows = await squishyDb
          .select()
          .from(squishySchema.botSettings)
          .where(eq(squishySchema.botSettings.key, 'channel.auto_voice_category'))
        if (rows.length > 0 && SNOWFLAKE_RE.test(rows[0].value)) {
          categoryId = rows[0].value
        }
      } catch (err) {
        console.warn('[squishy/hubs POST] fallback category lookup failed', err)
      }
    }
    if (!categoryId) {
      await writeAudit({
        bot: 'squishy',
        action: 'hub.added',
        actor: access.actor,
        viewing: access.viewing,
        targetType: 'hub_channels',
        targetId: voiceChannelId,
        success: false,
        errorMessage: 'categoryId-unset',
      }).catch(() => {})
      return NextResponse.json(
        {
          error:
            'categoryId not provided and channel.auto_voice_category is unset — pass categoryId explicitly or set the default first',
        },
        { status: 400 },
      )
    }

    if (!env.GUILD_ID) {
      await writeAudit({
        bot: 'squishy',
        action: 'hub.added',
        actor: access.actor,
        viewing: access.viewing,
        targetType: 'hub_channels',
        targetId: voiceChannelId,
        success: false,
        errorMessage: 'GUILD_ID-unset',
      }).catch(() => {})
      return NextResponse.json({ error: 'GUILD_ID is not configured' }, { status: 500 })
    }

    try {
      const inserted = await squishyDb
        .insert(squishySchema.hubChannels)
        .values({
          guildId: env.GUILD_ID,
          channelId: voiceChannelId,
          categoryId,
          position,
          // Drizzle column default kicks in when label is undefined.
          ...(label !== undefined ? { label } : {}),
        })
        .onConflictDoNothing({ target: squishySchema.hubChannels.channelId })
        .returning()

      if (inserted.length === 0) {
        await writeAudit({
          bot: 'squishy',
          action: 'hub.added',
          actor: access.actor,
          viewing: access.viewing,
          targetType: 'hub_channels',
          targetId: voiceChannelId,
          success: false,
          errorMessage: 'already-exists',
        }).catch(() => {})
        return NextResponse.json(
          { error: 'a hub with that voiceChannelId already exists' },
          { status: 409 },
        )
      }

      // Fire-and-forget cache refresh — best-effort; the row is in the DB
      // either way and `loadSettings()` on the next bot restart picks it up.
      const refresh = await callBot('squishy', 'hub.refresh_cache', {}, { timeoutMs: 3000 })
      if (!refresh.ok) {
        console.warn('[squishy/hubs POST] hub.refresh_cache failed', refresh)
      }

      await writeAudit({
        bot: 'squishy',
        action: 'hub.added',
        actor: access.actor,
        viewing: access.viewing,
        targetType: 'hub_channels',
        targetId: voiceChannelId,
        before: null,
        after: inserted[0],
        success: true,
      }).catch((err) => {
        console.warn('[squishy/hubs POST] audit write failed', err)
      })
      return NextResponse.json(
        { ok: true, row: inserted[0], refresh },
        { status: 201 },
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown'
      console.error('[squishy/hubs POST] db write failed', err)
      await writeAudit({
        bot: 'squishy',
        action: 'hub.added',
        actor: access.actor,
        viewing: access.viewing,
        targetType: 'hub_channels',
        targetId: voiceChannelId,
        success: false,
        errorMessage: msg,
      }).catch(() => {})
      return NextResponse.json({ error: 'db-write-failed' }, { status: 503 })
    }
  },
  {
    require: 'sudo',
    csrf: true,
    rateLimit: { points: 30, perSeconds: 60 },
  },
)

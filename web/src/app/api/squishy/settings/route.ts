/**
 * GET /api/squishy/settings — read-only dump of `bot_settings`.
 *
 * Returns every row, ordered by `key` ascending. The page itself reads the
 * same Drizzle query directly (server component); this endpoint exists so
 * client-side tooling / sudo scripts can pull the same data over HTTP.
 *
 * Resilience: if `squishyDb` throws (DB unreachable, or `SQUISHY_DATABASE_URL`
 * not set), return `{ settings: [], errorMessage: 'db-unavailable' }` with a 200 so
 * the caller can still render an empty-state UI instead of having to handle
 * a 500. Matches the pattern used by `/api/squishy/voice/list`.
 */
import { NextResponse } from 'next/server'
import { asc } from 'drizzle-orm'
import { withAuth } from '@/lib/auth/middleware'
import { squishyDb, squishySchema } from '@/lib/db/squishy'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type SettingRow = {
  key: string
  value: string
  updatedByDiscordId: string | null
  updatedAt: string
}

export const GET = withAuth(
  async () => {
    try {
      const rows = await squishyDb
        .select()
        .from(squishySchema.botSettings)
        .orderBy(asc(squishySchema.botSettings.key))

      const settings: SettingRow[] = rows.map((r) => ({
        key: r.key,
        value: r.value,
        updatedByDiscordId: r.updatedByDiscordId,
        updatedAt:
          r.updatedAt instanceof Date
            ? r.updatedAt.toISOString()
            : String(r.updatedAt),
      }))

      return NextResponse.json({ settings })
    } catch (err) {
      console.warn('[squishy/settings] DB unreachable; returning empty list', err)
      return NextResponse.json({ settings: [], errorMessage: 'db-unavailable' })
    }
  },
  { require: 'sudo' },
)

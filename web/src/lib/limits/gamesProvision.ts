/**
 * Shared per-guild + daily ceilings for the three Discord-resource-creating
 * routes used by the games editor:
 *
 *   - /api/squishy/games/provision      (channel + 2 roles + games row)
 *   - /api/squishy/discord/create-role  (1 role)
 *   - /api/squishy/discord/create-channel (1 channel)
 *
 * The per-actor rate limit on each route is already applied by `withAuth`
 * — that's the first gate. This module layers two additional buckets on
 * top, both keyed on the configured guild ID so multiple sudo sessions
 * cannot combine to exhaust Discord's per-guild caps (250 roles, 500
 * channels).
 *
 *   - per-minute guild ceiling: 15/min across all three routes
 *   - per-day  guild quota:    100/day across all three routes
 *
 * Both numbers are intentionally well below Discord's hard caps but well
 * above any plausible legitimate burst (auto-provisioning ~5 new games in
 * one sudo session fires ~20 resource creates). A stuck panel tab or
 * compromised session hits the ceiling long before the guild's role/channel
 * pool is at risk.
 *
 * The buckets are keyed on the GUILD_ID env (panel is single-guild today).
 * If `GUILD_ID` is unset we fall back to a `'_no_guild'` sentinel — the
 * route handlers themselves already reject when GUILD_ID is missing for
 * the actual write, but defending the limit key keeps the code simple.
 *
 * Returns `{ ok: true }` on allow, `{ ok: false, error, retryAfterSec }` on
 * deny. The error token is what the panel renders.
 *
 * See #226.
 */
import { checkRateLimit } from '@/lib/auth/middleware'
import { env } from '@/lib/env'

const PER_MIN_POINTS = 15
const PER_MIN_WINDOW = 60
const PER_DAY_POINTS = 100
const PER_DAY_WINDOW = 24 * 60 * 60

export type GuildLimitResult =
  | { ok: true }
  | { ok: false; error: 'guild-rate-limited' | 'guild-daily-quota'; retryAfterSec: number }

export function checkGamesWriteGuildLimits(): GuildLimitResult {
  const guildId = env.GUILD_ID ?? '_no_guild'
  const minuteKey = `guild:${guildId}:games-write:minute`
  const dailyKey = `guild:${guildId}:games-write:day`

  if (!checkRateLimit(minuteKey, PER_MIN_POINTS, PER_MIN_WINDOW)) {
    return { ok: false, error: 'guild-rate-limited', retryAfterSec: PER_MIN_WINDOW }
  }
  if (!checkRateLimit(dailyKey, PER_DAY_POINTS, PER_DAY_WINDOW)) {
    return { ok: false, error: 'guild-daily-quota', retryAfterSec: PER_DAY_WINDOW }
  }
  return { ok: true }
}

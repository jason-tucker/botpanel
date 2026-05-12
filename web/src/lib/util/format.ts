/**
 * Tiny string / number formatting helpers shared across the dashboard.
 *
 * Kept dependency-free on purpose — these are called from server components
 * in the hot path, and pulling a heavyweight date or i18n library just for a
 * "30 min" string is a poor trade. The relative-time logic is the same shape
 * as `AuditLive.tsx`'s in-component `relTime()`; we copied it here verbatim
 * (rather than re-importing across a server/client boundary) so a future
 * refactor can drop the duplicate without touching the audit page.
 */

/**
 * Coarse relative time. Past dates render as `"5m ago"`, future as `"in 5m"`.
 * Falls back to the ISO date prefix beyond ~30 days so we never silently
 * pretend a 6-month-old row is "180d ago" (it is, but it reads weird).
 *
 * Accepts either an ISO string or a `Date` so server components can hand it
 * a Drizzle `Date` directly without converting.
 */
export function relTime(input: string | Date): string {
  const then = input instanceof Date ? input.getTime() : new Date(input).getTime()
  if (!Number.isFinite(then)) return typeof input === 'string' ? input : String(input)
  const diff = Date.now() - then
  const abs = Math.abs(diff)
  const past = diff >= 0

  const sec = Math.round(abs / 1000)
  if (sec < 5) return 'just now'
  if (sec < 60) return past ? `${sec}s ago` : `in ${sec}s`
  const min = Math.round(sec / 60)
  if (min < 60) return past ? `${min}m ago` : `in ${min}m`
  const hr = Math.round(min / 60)
  if (hr < 24) return past ? `${hr}h ago` : `in ${hr}h`
  const day = Math.round(hr / 24)
  if (day < 30) return past ? `${day}d ago` : `in ${day}d`
  const iso = input instanceof Date ? input.toISOString() : input
  return iso.slice(0, 10)
}

/**
 * Format a duration in seconds for a `/play`-style cooldown column.
 *  - `null`/`undefined` → `"default"` (uses the global default elsewhere)
 *  - `0`                → `"disabled"`
 *  - `< 60`             → `"<n>s"`
 *  - `< 3600`           → `"<n> min"` (rounded)
 *  - else               → `"<n>h <m>m"` (drops the `0m` when minutes are zero)
 */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return 'default'
  if (!Number.isFinite(seconds)) return String(seconds)
  if (seconds === 0) return 'disabled'
  if (seconds < 0) return 'disabled'
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) {
    const min = Math.round(seconds / 60)
    return `${min} min`
  }
  const hr = Math.floor(seconds / 3600)
  const min = Math.round((seconds % 3600) / 60)
  return min === 0 ? `${hr}h` : `${hr}h ${min}m`
}

/**
 * Build a `discord.com` deep link for a channel. Returns `null` if either ID
 * is missing/blank so callers can render plain text instead of a broken link.
 * No validation beyond truthiness — the bot owns ID correctness upstream.
 */
export function discordChannelUrl(
  guildId: string | null | undefined,
  channelId: string | null | undefined,
): string | null {
  if (!guildId || !channelId) return null
  return `https://discord.com/channels/${guildId}/${channelId}`
}

/**
 * Build a `discord.com` deep link for a specific message. Returns `null` if
 * any of the three IDs are missing/blank — Discord won't resolve the URL
 * without all three components, so an "Open in Discord" link should hide
 * itself rather than render a broken target.
 */
export function discordMessageUrl(
  guildId: string | null | undefined,
  channelId: string | null | undefined,
  messageId: string | null | undefined,
): string | null {
  if (!guildId || !channelId || !messageId) return null
  return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`
}

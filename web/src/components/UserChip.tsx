/**
 * `<UserChip>` — render a Discord user as `[avatar] @displayName` (or fall
 * back to the raw snowflake if the bot didn't have them cached).
 *
 * Server component. Two ways to use it:
 *   1. With pre-resolved data: pass `resolved`. This is the batched path
 *      — call `resolveUsernames(...)` once at page-render top and zip the
 *      Map into each chip. Best for tables (audit, sudo, voice rosters).
 *   2. Without `resolved`: pass just `userId` and the chip renders the
 *      raw id only. Use this when you genuinely don't have lookup data
 *      yet (e.g. an SSE-fed list awaiting a follow-up fetch).
 *
 * Tooltip shows the raw id for both shapes so an operator who needs the
 * snowflake (audit cross-ref, copy-paste into Discord dev) can still get
 * it without hunting through the page.
 */
import Image from 'next/image'
import type { ResolvedUser } from '@/lib/userDisplay'

export type UserChipProps = {
  userId: string
  resolved?: ResolvedUser | null
}

export function UserChip({ userId, resolved }: UserChipProps) {
  if (!resolved) {
    return (
      <span
        className="inline-flex items-center font-mono text-xs text-ink whitespace-nowrap"
        title={userId}
      >
        {userId}
      </span>
    )
  }

  const label = resolved.displayName || resolved.username
  return (
    <span
      className="inline-flex items-center gap-1.5 align-middle whitespace-nowrap"
      title={`${userId} · @${resolved.username}`}
    >
      {/* next/image: cdn.discordapp.com is allowlisted in next.config.mjs so
          Next.js can serve auto-WebP + srcset for high-DPI. Lazy by default,
          which is what we want for chip lists (audit table, voice page, etc.). */}
      <Image
        src={resolved.avatarUrl}
        alt=""
        width={24}
        height={24}
        className="h-6 w-6 rounded-full border border-line"
        referrerPolicy="no-referrer"
      />
      <span className="text-sm text-ink">@{label}</span>
    </span>
  )
}

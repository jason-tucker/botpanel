/**
 * `<UserChipBatch>` — async server component that resolves a list of
 * snowflakes in one RPC round-trip and renders each as a `<UserChip>`.
 *
 * Use when you don't already have the resolved Map at the call-site (e.g.
 * inline in a page that doesn't otherwise need the lookup data for layout
 * decisions). For tables, prefer calling `resolveUsernames(...)` once at
 * the top of the page and passing `resolved={map.get(id)}` per row — the
 * Map roundtrip is identical but the page gets to render headers + counts
 * synchronously while React Suspends only the resolution path.
 *
 * Currently unused by any caller below but kept so future per-row
 * progressive-enhancement surfaces have a one-line option.
 */
import { resolveUsernames } from '@/lib/userDisplay'
import type { BotName } from '@/lib/botrpc'
import { UserChip } from './UserChip'

export type UserChipBatchProps = {
  bot: BotName
  userIds: string[]
  /**
   * Optional join character. Defaults to a single space; pass `', '` for
   * comma-separated inline lists.
   */
  separator?: string
}

export async function UserChipBatch({ bot, userIds, separator = ' ' }: UserChipBatchProps) {
  const resolved = await resolveUsernames(bot, userIds)
  return (
    <>
      {userIds.map((id, i) => (
        <span key={id}>
          {i > 0 ? separator : null}
          <UserChip userId={id} resolved={resolved.get(id) ?? null} />
        </span>
      ))}
    </>
  )
}

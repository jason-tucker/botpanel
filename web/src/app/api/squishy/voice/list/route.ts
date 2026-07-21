/**
 * GET /api/squishy/voice/list — initial snapshot for the live page.
 *
 * Returns every row in `auto_channels` plus its members from
 * `auto_channel_members`. The client opens an EventSource on
 * `/stream` immediately after this returns and merges deltas on top.
 *
 * Resilience: if `squishyDb` throws (DB unreachable, or `SQUISHY_DATABASE_URL`
 * not set yet), return `{ channels: [], error: 'db-unavailable' }` with a 200
 * so the page still renders and the live stream can still flow. The whole
 * point of the live view is that it works even if the snapshot is empty.
 */
import { NextResponse } from 'next/server'
import { desc } from 'drizzle-orm'
import { withAuth } from '@/lib/auth/middleware'
import { squishyDb, squishySchema } from '@/lib/db/squishy'
import { resolveUsernames } from '@/lib/userDisplay'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type MemberRow = {
  userId: string
  joinedAt: string
}

type ChannelRow = {
  voiceChannelId: string
  textChannelId: string
  name: string
  ownerUserId: string
  actingOwnerUserId: string | null
  hostUserIds: string[]
  locked: boolean
  hidden: boolean
  /**
   * True for static-channel companions (`source_hub_id = 'static'`). The
   * voice channel itself is permanent — never renamed, never deleted — so
   * the client hides those controls and the API routes reject the verbs.
   */
  isStatic: boolean
  createdAt: string
  members: MemberRow[]
  /**
   * Whether the *viewer* may operate the per-channel controls. Computed
   * server-side so the client never decides its own gating; the API routes
   * also re-verify before forwarding to the bot.
   */
  canControl: boolean
}

function nameOf(row: {
  manualName: string | null
  fallbackName: string | null
}): string {
  // Prefer the bot's last-known display name; fall back to the auto-name
  // template's static fallback; finally a generic "Unnamed channel" so the
  // UI never renders an empty title.
  if (row.manualName && row.manualName.trim()) return row.manualName
  if (row.fallbackName && row.fallbackName.trim()) return row.fallbackName
  return 'Unnamed channel'
}

export const GET = withAuth(
  async (_req, access) => {
    try {
      // Pull both tables in parallel — small dataset (a few dozen rows at
      // most) so a join is overkill. Group in-memory after.
      const [channels, members] = await Promise.all([
        squishyDb
          .select()
          .from(squishySchema.autoChannels)
          .orderBy(desc(squishySchema.autoChannels.createdAt)),
        squishyDb.select().from(squishySchema.autoChannelMembers),
      ])

      const byChannel = new Map<string, MemberRow[]>()
      for (const m of members) {
        const list = byChannel.get(m.voiceChannelId) ?? []
        list.push({
          userId: m.userId,
          joinedAt: m.joinedAt instanceof Date ? m.joinedAt.toISOString() : String(m.joinedAt),
        })
        byChannel.set(m.voiceChannelId, list)
      }
      // Stable order within a channel — oldest-joined first.
      for (const list of byChannel.values()) {
        list.sort((a, b) => a.joinedAt.localeCompare(b.joinedAt))
      }

      const viewerId = access.viewing.id
      const viewerIsPriv = access.botOwner || access.squishy.sudo

      const allRows: ChannelRow[] = channels.map((c) => {
        const canControl =
          viewerIsPriv ||
          viewerId === c.ownerUserId ||
          c.hostUserIds.includes(viewerId) ||
          c.actingOwnerUserId === viewerId
        return {
          voiceChannelId: c.voiceChannelId,
          textChannelId: c.textChannelId,
          name: nameOf(c),
          ownerUserId: c.ownerUserId,
          actingOwnerUserId: c.actingOwnerUserId,
          hostUserIds: c.hostUserIds,
          locked: c.isLocked,
          hidden: c.isHidden,
          isStatic: c.sourceHubId === 'static',
          createdAt: c.createdAt instanceof Date ? c.createdAt.toISOString() : String(c.createdAt),
          members: byChannel.get(c.voiceChannelId) ?? [],
          canControl,
        }
      })

      // Visibility filter — sudo/owner see everything; everyone else only
      // sees channels they have a real relationship with:
      //   1. owner / acting-owner / host (matches `canControl`)
      //   2. currently a member of the voice channel (in
      //      `auto_channel_members` — matches the Discord view since
      //      auto-channel text permissions are member-scoped)
      // Hidden channels still show to non-priv viewers as long as the
      // viewer passes the same gate — they're already inside, so the
      // dashboard parity holds.
      const rows: ChannelRow[] = viewerIsPriv
        ? allRows
        : allRows.filter(
            (c) =>
              c.canControl ||
              c.members.some((m) => m.userId === viewerId),
          )

      // Batch-resolve every snowflake referenced by the snapshot (owners,
      // acting owners, hosts, members) into `{username, displayName,
      // avatarUrl}` so the client can render chips without a follow-up
      // round-trip. 5-min in-process cache lives in `userDisplay.ts` so
      // the polling client doesn't pelt the bot every refresh. On RPC
      // failure the Map is empty and VoiceLive falls back to raw ids.
      const userIds: string[] = []
      for (const c of rows) {
        userIds.push(c.ownerUserId)
        if (c.actingOwnerUserId) userIds.push(c.actingOwnerUserId)
        for (const h of c.hostUserIds) userIds.push(h)
        for (const m of c.members) userIds.push(m.userId)
      }
      const resolvedMap = await resolveUsernames('squishy', userIds.filter(Boolean))
      const resolved: Record<string, { username: string; displayName: string; avatarUrl: string }> = {}
      for (const [id, v] of resolvedMap) resolved[id] = v

      return NextResponse.json({ channels: rows, resolved })
    } catch (err) {
      console.warn('[voice/list] DB unreachable; returning empty snapshot', err)
      return NextResponse.json({ channels: [], resolved: {}, error: 'db-unavailable' })
    }
  },
  { require: 'any' },
)

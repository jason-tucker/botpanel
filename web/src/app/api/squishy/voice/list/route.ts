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
  locked: boolean
  hidden: boolean
  createdAt: string
  members: MemberRow[]
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
  async () => {
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

      const rows: ChannelRow[] = channels.map((c) => ({
        voiceChannelId: c.voiceChannelId,
        textChannelId: c.textChannelId,
        name: nameOf(c),
        ownerUserId: c.ownerUserId,
        actingOwnerUserId: c.actingOwnerUserId,
        locked: c.isLocked,
        hidden: c.isHidden,
        createdAt: c.createdAt instanceof Date ? c.createdAt.toISOString() : String(c.createdAt),
        members: byChannel.get(c.voiceChannelId) ?? [],
      }))

      return NextResponse.json({ channels: rows })
    } catch (err) {
      console.warn('[voice/list] DB unreachable; returning empty snapshot', err)
      return NextResponse.json({ channels: [], error: 'db-unavailable' })
    }
  },
  { require: 'sudo' },
)

/**
 * /squishy/game-night — schedule fully-customizable Components-V2 game-night
 * posts (reusable embed editor + dynamic variables + Discord timestamps),
 * post now or at a chosen time, and manage already-scheduled / posted ones.
 *
 * Server component: gates on sudo, reads the bot's `scheduled_posts` table
 * directly (never 500s on DB-down — renders an empty state), and hands a plain
 * serializable DTO list to the client manager.
 */
import { desc, eq } from 'drizzle-orm'
import { getSession } from '@/lib/auth/session'
import { resolveAccess } from '@/lib/auth/perms'
import { getViewAsUserId } from '@/lib/auth/viewAs'
import { env } from '@/lib/env'
import { squishyDb, squishySchema } from '@/lib/db/squishy'
import type { MessageSpec } from '@/lib/msgspec/schema'
import { GameNightManager, type ScheduledPostDTO } from './GameNightManager'

export const dynamic = 'force-dynamic'

export default async function GameNightPage() {
  const session = await getSession()
  if (!session) {
    return <div className="p-6 text-sm text-ink-dim">Not signed in.</div>
  }
  const viewAsUserId = await getViewAsUserId()
  const access = await resolveAccess(session, viewAsUserId ? { viewAsUserId } : undefined)
  if (!(access.squishy.sudo || access.botOwner)) {
    return (
      <div className="p-6">
        <h1 className="text-lg font-semibold text-ink">Game Night</h1>
        <p className="mt-2 text-sm text-err">403 — sudo access required.</p>
      </div>
    )
  }

  let rows: ScheduledPostDTO[] = []
  let dbError = false
  if (env.GUILD_ID) {
    try {
      const raw = await squishyDb
        .select()
        .from(squishySchema.scheduledPosts)
        .where(eq(squishySchema.scheduledPosts.guildId, env.GUILD_ID))
        .orderBy(desc(squishySchema.scheduledPosts.createdAt))
        .limit(100)
      rows = raw.map((r): ScheduledPostDTO => {
        const vars = (r.variables ?? {}) as Record<string, unknown>
        return {
          id: r.id,
          title: r.title,
          channelId: r.channelId,
          status: r.status,
          kind: r.kind,
          enableRsvp: r.enableRsvp,
          fireAt: r.fireAt ? new Date(r.fireAt).toISOString() : null,
          postedAt: r.postedAt ? new Date(r.postedAt).toISOString() : null,
          messageId: r.messageId ?? null,
          error: r.error ?? null,
          eventAt: typeof vars.eventAt === 'string' ? vars.eventAt : null,
          notes: typeof vars.notes === 'string' ? vars.notes : '',
          steam: typeof vars.steam === 'string' ? vars.steam : '',
          spec: r.spec as MessageSpec,
          createdAt: new Date(r.createdAt).toISOString(),
        }
      })
    } catch {
      dbError = true
    }
  }

  return (
    <div className="p-4 sm:p-6 flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Game Night</h1>
        <p className="mt-1 text-sm text-ink-dim">
          Design a Discord post with the embed editor, drop in <code className="font-mono text-xs">{'{{variables}}'}</code> and
          timestamps, then post it now or schedule it. Posts get live RSVP buttons whose state is saved in the database.
        </p>
      </div>

      {!env.GUILD_ID && (
        <div className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">
          <code className="font-mono text-xs">GUILD_ID</code> is not configured in the panel env — scheduling is disabled until it is set.
        </div>
      )}
      {dbError && (
        <div className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">
          Couldn&apos;t reach SquishyBot&apos;s database — existing posts aren&apos;t shown. New posts will fail until it&apos;s back.
        </div>
      )}

      <GameNightManager
        existing={rows}
        rpcConfigured={!!env.BOTPANEL_RPC_SECRET}
        guildConfigured={!!env.GUILD_ID}
      />
    </div>
  )
}

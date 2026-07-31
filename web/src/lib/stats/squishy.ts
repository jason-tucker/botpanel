/**
 * Activity Stats — read-side data layer.
 *
 * Every query in this module reads the `activity_*` tables SquishyBot's
 * tracker/backfill write (`activity_message_stats`, `activity_emoji_stats`,
 * `activity_voice_sessions`, `activity_voice_stats`, `activity_presence_stats`,
 * `activity_member_events`, `activity_backfill_progress`) plus `bot_settings`
 * for the feature flag. Server-only — never imported by a client component.
 *
 * Timezone handling: `bucket` columns are UTC-valued Postgres `timestamp`
 * (no tz attached). To bucket by LOCAL day-of-week/hour we reinterpret the
 * naive timestamp as UTC, then shift to the caller's zone:
 *
 *   ((bucket AT TIME ZONE 'UTC') AT TIME ZONE $tz::text)
 *
 * The trailing `::text` cast on the tz parameter is required — without it
 * Postgres can't disambiguate the `timezone(text, timestamp)` overload from
 * `timezone(text, timestamptz)` when the value arrives as a bound parameter
 * instead of a literal. `tz` is always validated against `STATS_TZ_ALLOWLIST`
 * before it reaches SQL (belt-and-suspenders — `normalizeTz` guarantees a
 * bad querystring value can never reach here, but every query re-validates
 * via the `StatsTz` type at the call boundary).
 *
 * All dynamic values are passed through Drizzle's `sql` tag (parameterized —
 * never string-concatenated). The only non-parameterized text is a small,
 * fixed set of column/table names we write ourselves.
 *
 * Every exported query is best-effort: a DB hiccup logs a warning and
 * returns an empty/zeroed shape rather than throwing, so a page composing
 * a dozen of these can render a partially-degraded dashboard instead of a
 * 500. Pages that need an explicit "DB unreachable" banner should treat an
 * all-zero `ServerTotals` + `enabled: false` combination as a hint, but
 * genuinely down-DB is rare enough here that we don't thread a separate
 * ok/err signal through every call — see `getStatsEnabledState` if a page
 * needs to distinguish "off" from "unreachable" explicitly.
 */
import { and, asc, desc, eq, gte, inArray, isNotNull, sql, type SQL } from 'drizzle-orm'
import { squishyDb, squishySchema } from '@/lib/db/squishy'
import { env } from '@/lib/env'
import { resolveUsernames } from '@/lib/userDisplay'

// ─── Range / timezone / metric — validated inputs ──────────────────────

export const STATS_RANGES = ['7d', '30d', '90d', 'all'] as const
export type StatsRange = (typeof STATS_RANGES)[number]
export const DEFAULT_RANGE: StatsRange = '30d'

export const STATS_RANGE_LABELS: Record<StatsRange, string> = {
  '7d': '7 days',
  '30d': '30 days',
  '90d': '90 days',
  all: 'All time',
}

// Allowlist per contract — do not widen without also widening the tz cast
// comment above; an unvalidated tz string reaching `AT TIME ZONE` is a
// (low-severity, read-only) injection surface via Postgres zone-name lookup.
export const STATS_TZ_ALLOWLIST = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Berlin',
] as const
export type StatsTz = (typeof STATS_TZ_ALLOWLIST)[number]
export const DEFAULT_TZ: StatsTz = 'UTC'

export const STATS_TZ_LABELS: Record<StatsTz, string> = {
  UTC: 'UTC',
  'America/New_York': 'Eastern',
  'America/Chicago': 'Central',
  'America/Denver': 'Mountain',
  'America/Los_Angeles': 'Pacific',
  'Europe/London': 'London',
  'Europe/Berlin': 'Berlin',
}

export type StatsMetric = 'messages' | 'voice'

function firstParam(v: string | string[] | undefined | null): string | null {
  const s = Array.isArray(v) ? v[0] : v
  return typeof s === 'string' && s.length > 0 ? s : null
}

export function normalizeRange(v: string | string[] | undefined | null): StatsRange {
  const s = firstParam(v)
  return (STATS_RANGES as readonly string[]).includes(s ?? '') ? (s as StatsRange) : DEFAULT_RANGE
}

export function normalizeTz(v: string | string[] | undefined | null): StatsTz {
  const s = firstParam(v)
  return (STATS_TZ_ALLOWLIST as readonly string[]).includes(s ?? '') ? (s as StatsTz) : DEFAULT_TZ
}

export function normalizeMetric(v: string | string[] | undefined | null): StatsMetric {
  return firstParam(v) === 'voice' ? 'voice' : 'messages'
}

function rangeStartDate(range: StatsRange): Date | null {
  const now = Date.now()
  const DAY = 24 * 60 * 60 * 1000
  switch (range) {
    case '7d':
      return new Date(now - 7 * DAY)
    case '30d':
      return new Date(now - 30 * DAY)
    case '90d':
      return new Date(now - 90 * DAY)
    case 'all':
      return null
  }
}

// ─── Raw-SQL plumbing ───────────────────────────────────────────────────
//
// The heatmap / leaderboard / top-N aggregates below are cheaper to write
// as hand-rolled SQL (array_agg-pick-latest-name, EXTRACT over a tz-shifted
// timestamp) than to coax out of the query builder. `execRows` normalizes
// postgres-js's `db.execute()` return shape — mirrors the same defensive
// unwrap already used in `lib/auth/perms.ts`.

async function execRows<T = Record<string, unknown>>(query: SQL): Promise<T[]> {
  const result = await squishyDb.execute(query)
  const r = (result as unknown as { rows?: unknown[] }).rows ?? (result as unknown as unknown[])
  return Array.isArray(r) ? (r as T[]) : []
}

function rangeFilter(range: StatsRange): SQL {
  const start = rangeStartDate(range)
  // Must be an ISO string, never a raw Date: raw sql`` params bypass the
  // column's mapToDriverValue, and drizzle's postgres-js driver replaces the
  // Date serializer with an identity fn — a raw Date reaches
  // Buffer.byteLength() and throws, which the callers' catch blocks would
  // silently turn into an all-zero dashboard.
  return start ? sql`and bucket >= ${start.toISOString()}` : sql``
}

function guildFilter(): SQL {
  return env.GUILD_ID ? sql`and guild_id = ${env.GUILD_ID}` : sql``
}

/** The contract's tz-shift expression, exact form. */
function localTsExpr(tz: StatsTz): SQL {
  return sql`((bucket AT TIME ZONE 'UTC') AT TIME ZONE ${tz}::text)`
}

// ─── Heatmaps ───────────────────────────────────────────────────────────

export type HeatmapCell = { dow: number; hour: number; value: number }

function normalizeHeatmapRows(r: { dow: number; hour: number; value: number | null }[]): HeatmapCell[] {
  return r.map((x) => ({ dow: Number(x.dow), hour: Number(x.hour), value: Number(x.value ?? 0) }))
}

/** Message-count heatmap, optionally scoped to one user and/or one channel. */
async function queryMessagesHeatmap(
  range: StatsRange,
  tz: StatsTz,
  opts?: { userId?: string; channelId?: string },
): Promise<HeatmapCell[]> {
  const userClause = opts?.userId ? sql`and user_id = ${opts.userId}` : sql``
  const channelClause = opts?.channelId ? sql`and channel_id = ${opts.channelId}` : sql``
  try {
    const r = await execRows<{ dow: number; hour: number; value: number | null }>(sql`
      select extract(dow from ${localTsExpr(tz)})::int as dow,
             extract(hour from ${localTsExpr(tz)})::int as hour,
             sum(message_count)::int as value
      from activity_message_stats
      where 1 = 1 ${rangeFilter(range)} ${guildFilter()} ${userClause} ${channelClause}
      group by 1, 2
    `)
    return normalizeHeatmapRows(r)
  } catch (err) {
    console.warn('[stats/squishy] messages heatmap failed', err)
    return []
  }
}

/** Voice-minutes heatmap (seconds summed then divided to minutes for a
 *  human-scaled cell value), optionally scoped to one user and/or channel. */
async function queryVoiceHeatmap(
  range: StatsRange,
  tz: StatsTz,
  opts?: { userId?: string; channelId?: string },
): Promise<HeatmapCell[]> {
  const userClause = opts?.userId ? sql`and user_id = ${opts.userId}` : sql``
  const channelClause = opts?.channelId ? sql`and channel_id = ${opts.channelId}` : sql``
  try {
    const r = await execRows<{ dow: number; hour: number; value: number | null }>(sql`
      select extract(dow from ${localTsExpr(tz)})::int as dow,
             extract(hour from ${localTsExpr(tz)})::int as hour,
             round(sum(seconds) / 60.0)::int as value
      from activity_voice_stats
      where 1 = 1 ${rangeFilter(range)} ${guildFilter()} ${userClause} ${channelClause}
      group by 1, 2
    `)
    return normalizeHeatmapRows(r)
  } catch (err) {
    console.warn('[stats/squishy] voice heatmap failed', err)
    return []
  }
}

/** Server-wide heatmap for the overview page's metric-toggle card. */
export async function getServerHeatmap(metric: StatsMetric, range: StatsRange, tz: StatsTz): Promise<HeatmapCell[]> {
  return metric === 'voice' ? queryVoiceHeatmap(range, tz) : queryMessagesHeatmap(range, tz)
}

// ─── Channel / user activity aggregates (shared by leaderboards + detail pages) ──

export type ChannelActivityRow = { channelId: string; channelName: string | null; messages: number; voiceSeconds: number }
export type UserActivityRow = { userId: string; messages: number; voiceSeconds: number; lastActive: Date | null }

function toDateOrNull(v: string | Date | null | undefined): Date | null {
  if (!v) return null
  if (v instanceof Date) return v
  // Raw-SQL timestamps arrive as naive strings ('2026-07-01 12:00:00') and
  // are UTC wall-times — pin the parse to UTC so a future TZ env var on the
  // container can't shift them relative to the query-builder path.
  const s = v.includes('T') ? v : v.replace(' ', 'T')
  return new Date(/(?:[zZ]|[+-]\d\d:?\d\d)$/.test(s) ? s : s + 'Z')
}

/** Blended activity score used to rank both channels and users — messages
 *  weighted 1:1, voice seconds folded down to "minutes" so an hour of voice
 *  (60) roughly matches a burst of 60 messages rather than swamping the
 *  ranking with raw seconds. */
function rankByActivity<T extends { messages: number; voiceSeconds: number }>(list: T[], limit: number): T[] {
  return [...list]
    .sort((a, b) => b.messages + b.voiceSeconds / 60 - (a.messages + a.voiceSeconds / 60))
    .slice(0, limit)
}

async function aggregateChannelActivity(range: StatsRange, opts?: { userId?: string }): Promise<ChannelActivityRow[]> {
  const userClause = opts?.userId ? sql`and user_id = ${opts.userId}` : sql``
  try {
    const [msgRows, voiceRows] = await Promise.all([
      execRows<{ channel_id: string; channel_name: string | null; messages: number | null }>(sql`
        select channel_id,
               (array_agg(channel_name order by bucket desc) filter (where channel_name is not null))[1] as channel_name,
               sum(message_count)::int as messages
        from activity_message_stats
        where 1 = 1 ${rangeFilter(range)} ${guildFilter()} ${userClause}
        group by channel_id
        order by messages desc
        limit 5000
      `),
      execRows<{ channel_id: string; channel_name: string | null; voice_seconds: number | null }>(sql`
        select channel_id,
               (array_agg(channel_name order by bucket desc) filter (where channel_name is not null))[1] as channel_name,
               sum(seconds)::int as voice_seconds
        from activity_voice_stats
        where 1 = 1 ${rangeFilter(range)} ${guildFilter()} ${userClause}
        group by channel_id
        order by voice_seconds desc
        limit 5000
      `),
    ])
    const byChannel = new Map<string, ChannelActivityRow>()
    for (const r of msgRows) {
      byChannel.set(r.channel_id, {
        channelId: r.channel_id,
        channelName: r.channel_name,
        messages: r.messages ?? 0,
        voiceSeconds: 0,
      })
    }
    for (const r of voiceRows) {
      const existing = byChannel.get(r.channel_id)
      if (existing) {
        existing.voiceSeconds = r.voice_seconds ?? 0
        existing.channelName = existing.channelName ?? r.channel_name
      } else {
        byChannel.set(r.channel_id, {
          channelId: r.channel_id,
          channelName: r.channel_name,
          messages: 0,
          voiceSeconds: r.voice_seconds ?? 0,
        })
      }
    }
    return Array.from(byChannel.values())
  } catch (err) {
    console.warn('[stats/squishy] channel activity aggregate failed', err)
    return []
  }
}

async function aggregateUserActivity(range: StatsRange, opts?: { channelId?: string }): Promise<UserActivityRow[]> {
  const channelClause = opts?.channelId ? sql`and channel_id = ${opts.channelId}` : sql``
  try {
    const [msgRows, voiceRows] = await Promise.all([
      execRows<{ user_id: string; messages: number | null; last_bucket: string | Date | null }>(sql`
        select user_id, sum(message_count)::int as messages, max(bucket) as last_bucket
        from activity_message_stats
        where 1 = 1 ${rangeFilter(range)} ${guildFilter()} ${channelClause}
        group by user_id
        order by messages desc
        limit 5000
      `),
      execRows<{ user_id: string; voice_seconds: number | null; last_bucket: string | Date | null }>(sql`
        select user_id, sum(seconds)::int as voice_seconds, max(bucket) as last_bucket
        from activity_voice_stats
        where 1 = 1 ${rangeFilter(range)} ${guildFilter()} ${channelClause}
        group by user_id
        order by voice_seconds desc
        limit 5000
      `),
    ])
    const byUser = new Map<string, UserActivityRow>()
    for (const r of msgRows) {
      byUser.set(r.user_id, {
        userId: r.user_id,
        messages: r.messages ?? 0,
        voiceSeconds: 0,
        lastActive: toDateOrNull(r.last_bucket),
      })
    }
    for (const r of voiceRows) {
      const existing = byUser.get(r.user_id)
      const last = toDateOrNull(r.last_bucket)
      if (existing) {
        existing.voiceSeconds = r.voice_seconds ?? 0
        if (last && (!existing.lastActive || last > existing.lastActive)) existing.lastActive = last
      } else {
        byUser.set(r.user_id, { userId: r.user_id, messages: 0, voiceSeconds: r.voice_seconds ?? 0, lastActive: last })
      }
    }
    return Array.from(byUser.values())
  } catch (err) {
    console.warn('[stats/squishy] user activity aggregate failed', err)
    return []
  }
}

/** Server-wide channel leaderboard (BarList source on the overview page). */
export async function getChannelLeaderboard(range: StatsRange, limit = 10): Promise<ChannelActivityRow[]> {
  return rankByActivity(await aggregateChannelActivity(range), limit)
}

/** One user's top channels (per-user detail page). */
export async function getUserTopChannels(userId: string, range: StatsRange, limit = 8): Promise<ChannelActivityRow[]> {
  return rankByActivity(await aggregateChannelActivity(range, { userId }), limit)
}

/** Server-wide user leaderboard (`/squishy/stats/users` directory). */
export async function getUserLeaderboard(range: StatsRange, limit = 50): Promise<UserActivityRow[]> {
  return rankByActivity(await aggregateUserActivity(range), limit)
}

/** One channel's top users (per-channel detail page). */
export async function getChannelTopUsers(channelId: string, range: StatsRange, limit = 10): Promise<UserActivityRow[]> {
  return rankByActivity(await aggregateUserActivity(range, { channelId }), limit)
}

// ─── Emojis ─────────────────────────────────────────────────────────────

export type EmojiKind = 'message' | 'reaction_given' | 'reaction_received'
export type EmojiRow = { emojiKey: string; emojiName: string | null; custom: boolean; count: number }

/** `emojiKey` is a custom-emoji snowflake or the unicode sequence itself —
 *  render via `https://cdn.discordapp.com/emojis/{id}.png` when `custom`,
 *  otherwise render `emojiKey` directly as text. */
export async function getTopEmojis(
  kind: EmojiKind,
  range: StatsRange,
  limit = 10,
  opts?: { userId?: string },
): Promise<EmojiRow[]> {
  const userClause = opts?.userId ? sql`and user_id = ${opts.userId}` : sql``
  try {
    // Group by key+custom only — emoji_name is captured at write time, so a
    // renamed custom emoji would otherwise split into two half-counted rows.
    // Latest non-null name wins, same trick as the channel_name pick above.
    const r = await execRows<{ emoji_key: string; emoji_name: string | null; custom: boolean; count: number | null }>(sql`
      select emoji_key,
             (array_agg(emoji_name order by bucket desc) filter (where emoji_name is not null))[1] as emoji_name,
             custom,
             sum(count)::int as count
      from activity_emoji_stats
      where kind = ${kind} ${rangeFilter(range)} ${guildFilter()} ${userClause}
      group by emoji_key, custom
      order by count desc
      limit ${limit}
    `)
    return r.map((x) => ({ emojiKey: x.emoji_key, emojiName: x.emoji_name, custom: Boolean(x.custom), count: x.count ?? 0 }))
  } catch (err) {
    console.warn('[stats/squishy] top emojis load failed', err)
    return []
  }
}

// ─── Games (presence) ───────────────────────────────────────────────────

export type GameRow = { gameName: string; seconds: number }

export async function getTopGames(range: StatsRange, limit = 10, opts?: { userId?: string }): Promise<GameRow[]> {
  const userClause = opts?.userId ? sql`and user_id = ${opts.userId}` : sql``
  try {
    const r = await execRows<{ game_name: string; seconds: number | null }>(sql`
      select game_name, sum(seconds)::int as seconds
      from activity_presence_stats
      where 1 = 1 ${rangeFilter(range)} ${guildFilter()} ${userClause}
      group by game_name
      order by seconds desc
      limit ${limit}
    `)
    return r.map((x) => ({ gameName: x.game_name, seconds: x.seconds ?? 0 }))
  } catch (err) {
    console.warn('[stats/squishy] top games load failed', err)
    return []
  }
}

// ─── Server totals (KPI grid) ────────────────────────────────────────────

export type ServerTotals = {
  messages: number
  activeUsers: number
  voiceSeconds: number
  /** Count of `kind = 'reaction_given'` events — i.e. reactions people gave,
   *  not received. Picking one direction avoids double-counting the same
   *  reaction event as two "reactions" in the headline KPI. */
  reactions: number
  topGame: GameRow | null
}

export async function getServerTotals(range: StatsRange): Promise<ServerTotals> {
  try {
    const [msgRows, voiceRows, reactRows, activeRows, gameRows] = await Promise.all([
      execRows<{ total: number | null }>(sql`
        select sum(message_count)::int as total from activity_message_stats
        where 1 = 1 ${rangeFilter(range)} ${guildFilter()}
      `),
      execRows<{ total: number | null }>(sql`
        select sum(seconds)::int as total from activity_voice_stats
        where 1 = 1 ${rangeFilter(range)} ${guildFilter()}
      `),
      execRows<{ total: number | null }>(sql`
        select sum(count)::int as total from activity_emoji_stats
        where kind = 'reaction_given' ${rangeFilter(range)} ${guildFilter()}
      `),
      execRows<{ cnt: number | null }>(sql`
        select count(distinct user_id)::int as cnt from (
          select user_id from activity_message_stats where 1 = 1 ${rangeFilter(range)} ${guildFilter()}
          union
          select user_id from activity_voice_stats where 1 = 1 ${rangeFilter(range)} ${guildFilter()}
        ) t
      `),
      execRows<{ game_name: string; total: number | null }>(sql`
        select game_name, sum(seconds)::int as total from activity_presence_stats
        where 1 = 1 ${rangeFilter(range)} ${guildFilter()}
        group by game_name order by total desc limit 1
      `),
    ])
    return {
      messages: msgRows[0]?.total ?? 0,
      voiceSeconds: voiceRows[0]?.total ?? 0,
      reactions: reactRows[0]?.total ?? 0,
      activeUsers: activeRows[0]?.cnt ?? 0,
      topGame: gameRows[0] ? { gameName: gameRows[0].game_name, seconds: gameRows[0].total ?? 0 } : null,
    }
  } catch (err) {
    console.warn('[stats/squishy] server totals load failed', err)
    return { messages: 0, activeUsers: 0, voiceSeconds: 0, reactions: 0, topGame: null }
  }
}

// ─── Member trend ─────────────────────────────────────────────────────────

export type MemberTrendPoint = { t: number; value: number }

/** Plots the STORED `member_count` snapshots on `activity_member_events`
 *  over time — never a cumulative delta of join/leave events (bots are
 *  excluded from those events but still move `memberCount`, so deriving a
 *  running total from event counts would drift). */
export async function getMemberTrend(range: StatsRange, limit = 2000): Promise<MemberTrendPoint[]> {
  try {
    const start = rangeStartDate(range)
    const conditions = [isNotNull(squishySchema.activityMemberEvents.memberCount)]
    if (env.GUILD_ID) conditions.push(eq(squishySchema.activityMemberEvents.guildId, env.GUILD_ID))
    if (start) conditions.push(gte(squishySchema.activityMemberEvents.at, start))
    // DESC + LIMIT takes the NEWEST rows (ASC would freeze the chart on the
    // oldest `limit` events forever once the append-only table outgrows it),
    // then reverse back to chronological order for plotting.
    const r = await squishyDb
      .select({ at: squishySchema.activityMemberEvents.at, memberCount: squishySchema.activityMemberEvents.memberCount })
      .from(squishySchema.activityMemberEvents)
      .where(and(...conditions))
      .orderBy(desc(squishySchema.activityMemberEvents.at))
      .limit(limit)
    return r
      .filter((x): x is { at: Date; memberCount: number } => x.memberCount !== null)
      .map((x) => ({ t: x.at.getTime(), value: x.memberCount }))
      .reverse()
  } catch (err) {
    console.warn('[stats/squishy] member trend load failed', err)
    return []
  }
}

// ─── Feature-flag / backfill state ───────────────────────────────────────

export type StatsEnabledState = {
  enabled: boolean
  enabledAt: Date | null
  backfillEnabled: boolean
}

async function readBotSettingValue(key: string): Promise<string | null> {
  try {
    const r = await squishyDb
      .select({ value: squishySchema.botSettings.value })
      .from(squishySchema.botSettings)
      .where(eq(squishySchema.botSettings.key, key))
      .limit(1)
    return r[0]?.value ?? null
  } catch (err) {
    console.warn(`[stats/squishy] bot_settings read failed for ${key}`, err)
    return null
  }
}

export async function getStatsEnabledState(): Promise<StatsEnabledState> {
  const [enabledRaw, enabledAtRaw, backfillRaw] = await Promise.all([
    readBotSettingValue('feature.activity_stats'),
    readBotSettingValue('stats.enabled_at'),
    readBotSettingValue('stats.backfill.enabled'),
  ])
  let enabledAt: Date | null = null
  if (enabledAtRaw) {
    const d = new Date(enabledAtRaw)
    if (!Number.isNaN(d.getTime())) enabledAt = d
  }
  return {
    enabled: enabledRaw === 'true',
    enabledAt,
    backfillEnabled: backfillRaw === 'true',
  }
}

export type BackfillProgressRow = {
  channelId: string
  channelName: string | null
  status: string
  messagesScanned: number
  oldestSeenAt: Date | null
  error: string | null
  updatedAt: Date
}

export type BackfillSummary = {
  channels: { total: number; done: number; running: number; pending: number; error: number; skipped: number }
  messagesScanned: number
  currentChannelId: string | null
  rows: BackfillProgressRow[]
}

const EMPTY_BACKFILL_SUMMARY: BackfillSummary = {
  channels: { total: 0, done: 0, running: 0, pending: 0, error: 0, skipped: 0 },
  messagesScanned: 0,
  currentChannelId: null,
  rows: [],
}

export async function getBackfillSummary(): Promise<BackfillSummary> {
  try {
    const raw = await squishyDb
      .select()
      .from(squishySchema.activityBackfillProgress)
      .orderBy(desc(squishySchema.activityBackfillProgress.updatedAt))

    const channels = { total: raw.length, done: 0, running: 0, pending: 0, error: 0, skipped: 0 }
    let messagesScanned = 0
    let currentChannelId: string | null = null
    const rowsOut: BackfillProgressRow[] = []
    for (const r of raw) {
      messagesScanned += r.messagesScanned ?? 0
      if (r.status === 'done') channels.done++
      else if (r.status === 'running') {
        channels.running++
        if (!currentChannelId) currentChannelId = r.channelId
      } else if (r.status === 'pending') channels.pending++
      else if (r.status === 'error') channels.error++
      else if (r.status === 'skipped') channels.skipped++
      rowsOut.push({
        channelId: r.channelId,
        channelName: r.channelName,
        status: r.status,
        messagesScanned: r.messagesScanned ?? 0,
        oldestSeenAt: r.oldestSeenAt,
        error: r.error,
        updatedAt: r.updatedAt,
      })
    }
    return { channels, messagesScanned, currentChannelId, rows: rowsOut }
  } catch (err) {
    console.warn('[stats/squishy] backfill summary load failed', err)
    return EMPTY_BACKFILL_SUMMARY
  }
}

// ─── Per-user detail page ─────────────────────────────────────────────────

export type VoiceSessionRow = {
  id: string
  channelId: string
  channelName: string | null
  joinedAt: Date
  leftAt: Date | null
  durationSeconds: number | null
}

async function loadRecentVoiceSessions(userId: string, limit = 10): Promise<VoiceSessionRow[]> {
  try {
    const raw = await squishyDb
      .select({
        id: squishySchema.activityVoiceSessions.id,
        channelId: squishySchema.activityVoiceSessions.channelId,
        channelName: squishySchema.activityVoiceSessions.channelName,
        joinedAt: squishySchema.activityVoiceSessions.joinedAt,
        leftAt: squishySchema.activityVoiceSessions.leftAt,
        durationSeconds: squishySchema.activityVoiceSessions.durationSeconds,
      })
      .from(squishySchema.activityVoiceSessions)
      .where(eq(squishySchema.activityVoiceSessions.userId, userId))
      .orderBy(desc(squishySchema.activityVoiceSessions.joinedAt))
      .limit(limit)
    return raw
  } catch (err) {
    console.warn('[stats/squishy] recent voice sessions load failed', err)
    return []
  }
}

async function getUserActivityBounds(userId: string): Promise<{ first: Date | null; last: Date | null }> {
  try {
    const [msgBounds, voiceStatBounds, sessionBounds] = await Promise.all([
      execRows<{ first: string | Date | null; last: string | Date | null }>(sql`
        select min(bucket) as first, max(bucket) as last from activity_message_stats where user_id = ${userId}
      `),
      execRows<{ first: string | Date | null; last: string | Date | null }>(sql`
        select min(bucket) as first, max(bucket) as last from activity_voice_stats where user_id = ${userId}
      `),
      execRows<{ first: string | Date | null; last: string | Date | null }>(sql`
        select min(joined_at) as first, max(coalesce(left_at, joined_at)) as last
        from activity_voice_sessions where user_id = ${userId}
      `),
    ])
    let first: Date | null = null
    let last: Date | null = null
    for (const c of [msgBounds[0], voiceStatBounds[0], sessionBounds[0]]) {
      const f = toDateOrNull(c?.first ?? null)
      const l = toDateOrNull(c?.last ?? null)
      if (f && (!first || f < first)) first = f
      if (l && (!last || l > last)) last = l
    }
    return { first, last }
  } catch (err) {
    console.warn('[stats/squishy] user activity bounds load failed', err)
    return { first: null, last: null }
  }
}

export type UserStats = {
  userId: string
  totals: {
    messages: number
    wordCount: number
    voiceSeconds: number
    reactionsGiven: number
    reactionsReceived: number
  }
  textHeatmap: HeatmapCell[]
  voiceHeatmap: HeatmapCell[]
  topChannels: ChannelActivityRow[]
  topEmojisGiven: EmojiRow[]
  topEmojisReceived: EmojiRow[]
  topGames: GameRow[]
  recentVoiceSessions: VoiceSessionRow[]
  firstSeen: Date | null
  lastSeen: Date | null
}

export async function getUserStats(userId: string, range: StatsRange, tz: StatsTz): Promise<UserStats> {
  const [
    msgTotalsRows,
    voiceTotalsRows,
    reactGivenRows,
    reactReceivedRows,
    textHeatmap,
    voiceHeatmap,
    topChannels,
    topEmojisGiven,
    topEmojisReceived,
    topGames,
    recentVoiceSessions,
    bounds,
  ] = await Promise.all([
    execRows<{ messages: number | null; words: number | null }>(sql`
      select sum(message_count)::int as messages, sum(word_count)::int as words
      from activity_message_stats where user_id = ${userId} ${rangeFilter(range)} ${guildFilter()}
    `).catch((err) => {
      console.warn('[stats/squishy] user message totals failed', err)
      return [] as { messages: number | null; words: number | null }[]
    }),
    execRows<{ seconds: number | null }>(sql`
      select sum(seconds)::int as seconds
      from activity_voice_stats where user_id = ${userId} ${rangeFilter(range)} ${guildFilter()}
    `).catch((err) => {
      console.warn('[stats/squishy] user voice totals failed', err)
      return [] as { seconds: number | null }[]
    }),
    execRows<{ total: number | null }>(sql`
      select sum(count)::int as total from activity_emoji_stats
      where user_id = ${userId} and kind = 'reaction_given' ${rangeFilter(range)} ${guildFilter()}
    `).catch((err) => {
      console.warn('[stats/squishy] user reactions-given total failed', err)
      return [] as { total: number | null }[]
    }),
    execRows<{ total: number | null }>(sql`
      select sum(count)::int as total from activity_emoji_stats
      where user_id = ${userId} and kind = 'reaction_received' ${rangeFilter(range)} ${guildFilter()}
    `).catch((err) => {
      console.warn('[stats/squishy] user reactions-received total failed', err)
      return [] as { total: number | null }[]
    }),
    queryMessagesHeatmap(range, tz, { userId }),
    queryVoiceHeatmap(range, tz, { userId }),
    getUserTopChannels(userId, range, 8),
    getTopEmojis('reaction_given', range, 8, { userId }),
    getTopEmojis('reaction_received', range, 8, { userId }),
    getTopGames(range, 8, { userId }),
    loadRecentVoiceSessions(userId, 10),
    getUserActivityBounds(userId),
  ])

  return {
    userId,
    totals: {
      messages: msgTotalsRows[0]?.messages ?? 0,
      wordCount: msgTotalsRows[0]?.words ?? 0,
      voiceSeconds: voiceTotalsRows[0]?.seconds ?? 0,
      reactionsGiven: reactGivenRows[0]?.total ?? 0,
      reactionsReceived: reactReceivedRows[0]?.total ?? 0,
    },
    textHeatmap,
    voiceHeatmap,
    topChannels,
    topEmojisGiven,
    topEmojisReceived,
    topGames,
    recentVoiceSessions,
    firstSeen: bounds.first,
    lastSeen: bounds.last,
  }
}

// ─── Per-channel detail page ───────────────────────────────────────────────

export type ChannelStats = {
  channelId: string
  channelName: string | null
  totals: { messages: number; voiceSeconds: number }
  heatmap: HeatmapCell[]
  topUsers: UserActivityRow[]
}

export async function getChannelStats(
  channelId: string,
  range: StatsRange,
  tz: StatsTz,
  metric: StatsMetric = 'messages',
): Promise<ChannelStats> {
  const [msgAgg, voiceAgg, heatmap, topUsers] = await Promise.all([
    execRows<{ messages: number | null; name: string | null }>(sql`
      select sum(message_count)::int as messages,
             (array_agg(channel_name order by bucket desc) filter (where channel_name is not null))[1] as name
      from activity_message_stats where channel_id = ${channelId} ${rangeFilter(range)} ${guildFilter()}
    `).catch((err) => {
      console.warn('[stats/squishy] channel message totals failed', err)
      return [] as { messages: number | null; name: string | null }[]
    }),
    execRows<{ voice_seconds: number | null; name: string | null }>(sql`
      select sum(seconds)::int as voice_seconds,
             (array_agg(channel_name order by bucket desc) filter (where channel_name is not null))[1] as name
      from activity_voice_stats where channel_id = ${channelId} ${rangeFilter(range)} ${guildFilter()}
    `).catch((err) => {
      console.warn('[stats/squishy] channel voice totals failed', err)
      return [] as { voice_seconds: number | null; name: string | null }[]
    }),
    metric === 'voice' ? queryVoiceHeatmap(range, tz, { channelId }) : queryMessagesHeatmap(range, tz, { channelId }),
    getChannelTopUsers(channelId, range, 10),
  ])

  return {
    channelId,
    channelName: msgAgg[0]?.name ?? voiceAgg[0]?.name ?? null,
    totals: {
      messages: msgAgg[0]?.messages ?? 0,
      voiceSeconds: voiceAgg[0]?.voice_seconds ?? 0,
    },
    heatmap,
    topUsers,
  }
}

// ─── Display-name resolution ────────────────────────────────────────────

export type DisplayInfo = { name: string; avatarUrl: string | null }

/**
 * Snowflake → display name/avatar, with the fallback chain the contract
 * asks for: bot RPC (`resolveUsernames`, cached, empty on bot-down) →
 * `user_profiles.displayName` for anything the bot didn't have cached →
 * the raw snowflake as an absolute last resort so a row never renders
 * blank.
 */
export async function resolveDisplayNames(userIds: string[]): Promise<Map<string, DisplayInfo>> {
  const out = new Map<string, DisplayInfo>()
  const uniq = Array.from(new Set(userIds))
  if (uniq.length === 0) return out

  const resolved = await resolveUsernames('squishy', uniq)
  const missing: string[] = []
  for (const id of uniq) {
    const r = resolved.get(id)
    if (r) {
      out.set(id, { name: r.displayName || r.username || id, avatarUrl: r.avatarUrl || null })
    } else {
      missing.push(id)
    }
  }

  if (missing.length > 0) {
    try {
      const profileRows = await squishyDb
        .select({ userId: squishySchema.userProfiles.userId, displayName: squishySchema.userProfiles.displayName })
        .from(squishySchema.userProfiles)
        .where(inArray(squishySchema.userProfiles.userId, missing))
      for (const r of profileRows) {
        if (r.displayName && r.displayName.trim()) {
          out.set(r.userId, { name: r.displayName.trim(), avatarUrl: null })
        }
      }
    } catch (err) {
      console.warn('[stats/squishy] user_profiles display-name fallback failed', err)
    }
  }

  for (const id of uniq) {
    if (!out.has(id)) out.set(id, { name: id, avatarUrl: null })
  }

  return out
}

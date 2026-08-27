/**
 * Capabilities, not tiers.
 *
 * `resolveAccess()` returns a flat `AccessMap` describing exactly what the
 * current viewer can do. Every API route + page reads from this. Do NOT
 * invent new tier enums — if you need a new capability, add an explicit
 * field here.
 *
 * View-As: bot-owner or Squishy-sudo can act as another user. We always
 * resolve the REAL user's access first (so impersonation can't escalate),
 * and only swap `viewing` if the actor passes the gate. Audit rows must
 * record BOTH `actor` (real) and `viewing` (impersonated) — that plumbing
 * lives in `src/lib/audit.ts` and reads `access.actor` / `access.viewing`.
 *
 * DB unavailable: every DB call is wrapped — a downed Postgres degrades
 * to "empty capabilities" rather than 500-ing the whole panel.
 */
import { cache } from 'react'
import { sql } from 'drizzle-orm'
import { env } from '../env'
import type { Session } from './session'

// The spec refers to `session.sub` / `session.username` / `session.avatar`.
// Our JWT payload (see ./session.ts) uses `id` rather than `sub`. Accept
// both shapes so this resolver is usable from any caller that has a
// Discord-shaped identity.
export type SessionPayload = Session | {
  sub: string
  username: string
  avatar?: string | null
}

export type BusinessRank = 'owner' | 'manager' | 'employee'

export type AccessMap = {
  actor: { id: string; username: string; avatar: string | null }
  viewing: { id: string; username: string; avatar: string | null }
  botOwner: boolean
  squishy: {
    sudo: boolean
    voiceChannels: string[]
    canSelfEdit: true
  }
  otter: {
    businesses: Record<string, BusinessRank>
    /**
     * Raw Discord role ids the viewer holds in the Otter guild(s),
     * @everyone excluded. Supplied by the bot's `business.user_ranks`
     * verb. Needed for access rules that name roles directly rather than
     * ranks (e.g. the configurable OC-stock view/edit allowlists in
     * `src/lib/otter/ocStockAccess.ts`). Empty when the bot is
     * unreachable — role-based grants then simply don't apply.
     */
    roleIds: string[]
  }
}

type Identity = { id: string; username: string; avatar: string | null }

function identityOf(s: SessionPayload): Identity {
  // Normalize both `{ id, ... }` and `{ sub, ... }` shapes.
  const id = 'id' in s ? s.id : s.sub
  return {
    id,
    username: s.username,
    avatar: s.avatar ?? null,
  }
}

// Parsed once at module load — env is immutable for the process lifetime,
// so re-splitting the same string on every resolveAccess() call was waste.
const ENV_SUDO_IDS: ReadonlySet<string> = new Set(
  (env.SUDO_USER_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
)

async function checkSudoDb(userId: string): Promise<boolean> {
  try {
    // Lazy-import so a downed DB module never breaks the auth path at boot.
    const { squishyDb } = await import('../db/squishy')
    if (!squishyDb) return false
    // Raw SQL keeps us independent of whatever the vendored schema names
    // the table — the schema-sync PR will land the typed equivalent.
    const result = await squishyDb.execute(sql`select 1 from sudo_users where user_id = ${userId} limit 1`)
    const rows = (result as unknown as { rows?: unknown[] }).rows ?? (result as unknown as unknown[])
    return Array.isArray(rows) ? rows.length > 0 : false
  } catch (err) {
    console.warn('[perms] sudo_users lookup failed; treating as not-sudo', err)
    return false
  }
}

async function loadVoiceChannels(userId: string): Promise<string[]> {
  try {
    const { squishyDb } = await import('../db/squishy')
    if (!squishyDb) return []
    const result = await squishyDb.execute(sql`
      select voice_channel_id
      from auto_channels
      where owner_user_id = ${userId}
         or acting_owner_user_id = ${userId}
    `)
    const rows = (result as unknown as { rows?: unknown[] }).rows ?? (result as unknown as unknown[])
    // TODO(V2): JSONB `hosts` array lookup — host-permission grants on
    // someone else's channel. Schema-sync PR will land the typed col.
    const ids: string[] = []
    for (const r of rows ?? []) {
      const v = (r as { voice_channel_id?: unknown }).voice_channel_id
      if (typeof v === 'string') ids.push(v)
    }
    return ids
  } catch (err) {
    console.warn('[perms] auto_channels lookup failed; returning []', err)
    return []
  }
}

// Module-level cache so resolveAccess() across many requests doesn't
// hammer the bot. Keyed by userId. 60s TTL — fresh enough that a sudo
// granting someone a role sees the effect within a minute on the panel.
type OtterAccess = { ranks: Record<string, BusinessRank>; roleIds: string[] }

const otterRanksCache = new Map<string, { value: OtterAccess; expiresAt: number }>()
const OTTER_RANKS_TTL_MS = 60_000
// Expired entries used to linger forever (reads delete-on-miss only for
// the key being read), so the map grew one stale entry per distinct
// visitor for the process lifetime. Sweep opportunistically on insert
// once the map is non-trivially sized — O(n) on a small map, amortized.
const OTTER_RANKS_SWEEP_THRESHOLD = 256

function sweepOtterRanksCache(now: number): void {
  if (otterRanksCache.size < OTTER_RANKS_SWEEP_THRESHOLD) return
  for (const [key, entry] of otterRanksCache) {
    if (entry.expiresAt <= now) otterRanksCache.delete(key)
  }
}

const EMPTY_OTTER_ACCESS: OtterAccess = { ranks: {}, roleIds: [] }

async function loadOtterBusinesses(userId: string): Promise<OtterAccess> {
  const now = Date.now()
  const cached = otterRanksCache.get(userId)
  if (cached && cached.expiresAt > now) return cached.value

  // The previous implementation tried to derive otter ranks from direct
  // SQL — `where m.user_id = $1` on `business_role_mappings`. That column
  // doesn't exist (the table maps role IDs to ranks, not users; manager
  // and employee membership lives EXCLUSIVELY as Discord roles on the
  // member object). The bot's `business.user_ranks` verb walks
  // `guild.members.cache` + `business_role_mappings.role_id` and folds
  // in `business_owners` to return the right rank per business slug.
  try {
    const { callBot } = await import('../botrpc')
    const reply = await callBot<{ ranks: Record<string, string>; roleIds?: string[] }>(
      'otter',
      'business.user_ranks',
      { userId },
      { timeoutMs: 3000 },
    )
    if (!reply.ok) {
      // Bot down / unreachable — return empty (no rank). Worse than a
      // wrong answer, but a missing answer is recoverable on next page
      // load. Don't cache the empty result so we retry instead of
      // wedging the user out for 60s.
      console.warn('[perms] business.user_ranks failed; returning {}', reply.error)
      return EMPTY_OTTER_ACCESS
    }
    const ranks: Record<string, BusinessRank> = {}
    for (const [slug, rank] of Object.entries(reply.data.ranks ?? {})) {
      if (rank === 'owner' || rank === 'manager' || rank === 'employee') {
        ranks[slug] = rank
      }
    }
    // `roleIds` is optional on the wire: an older bot build (pre-role-grant)
    // replies without it. Treat a missing field as "no role grants" rather
    // than failing the whole resolve.
    const roleIds = Array.isArray(reply.data.roleIds)
      ? reply.data.roleIds.filter((r): r is string => typeof r === 'string')
      : []
    const value: OtterAccess = { ranks, roleIds }
    sweepOtterRanksCache(now)
    otterRanksCache.set(userId, { value, expiresAt: now + OTTER_RANKS_TTL_MS })
    return value
  } catch (err) {
    console.warn('[perms] otter businesses lookup failed; returning {}', err)
    return EMPTY_OTTER_ACCESS
  }
}

type ResolvedCaps = {
  botOwner: boolean
  squishy: AccessMap['squishy']
  otter: AccessMap['otter']
}

/**
 * Resolve the capability map for a user id. All three backing lookups
 * (sudo table, voice-channel ownership, otter business ranks) are
 * independent, so they run in a single parallel round instead of the
 * old sudo-first-then-the-rest sequence. When the env list already
 * grants sudo we skip the `sudo_users` query entirely — env wins
 * regardless of what the table says.
 */
async function resolveCapsUncached(userId: string): Promise<ResolvedCaps> {
  // TODO(V2): bot owner === BOT_OWNER_ID OR member of the Discord
  // Application Team (Admins + Developers), resolved over the Redis
  // command bus via `cmd.squishy.team.list`. For now, single-user env.
  const botOwner = userId === env.BOT_OWNER_ID

  // TODO(V2): SUDO_ROLE_IDS — needs a Discord member fetch to check
  // roles; deferred until we have the bot RPC for guild member lookup.
  const envSudo = ENV_SUDO_IDS.has(userId)

  const [dbSudo, voiceChannels, otter] = await Promise.all([
    envSudo ? Promise.resolve(true) : checkSudoDb(userId),
    loadVoiceChannels(userId),
    loadOtterBusinesses(userId),
  ])

  return {
    botOwner,
    squishy: {
      sudo: envSudo || dbSudo,
      voiceChannels,
      canSelfEdit: true,
    },
    otter: { businesses: otter.ranks, roleIds: otter.roleIds },
  }
}

/**
 * Per-request memoization via React `cache()`. The `(dashboard)` layout
 * resolves access for the sidebar, then the page resolves it again for
 * its own gate — both in the same React render pass, so this collapses
 * the duplicate Postgres/RPC round-trips into one. Outside a render
 * (API route handlers) React falls back to calling the function
 * directly, which is exactly the previous behaviour. The memo key is
 * the user id (a string), so actor + View-As target are cached
 * independently. NEVER cross-request: React drops the cache with the
 * request, so capability changes are picked up on the next navigation.
 */
const resolveCaps = cache(resolveCapsUncached)

async function resolveFor(subject: Identity): Promise<ResolvedCaps> {
  return resolveCaps(subject.id)
}

export async function resolveAccess(
  session: SessionPayload,
  opts?: { viewAsUserId?: string },
): Promise<AccessMap> {
  const actor = identityOf(session)
  const actorCaps = await resolveFor(actor)

  // No impersonation requested — short-circuit.
  if (!opts?.viewAsUserId || opts.viewAsUserId === actor.id) {
    return {
      actor,
      viewing: actor,
      botOwner: actorCaps.botOwner,
      squishy: actorCaps.squishy,
      otter: actorCaps.otter,
    }
  }

  // View-As gate. Sudo and bot-owner can impersonate; everyone else
  // silently falls back to self-resolution (no surprise privilege grant).
  const canImpersonate = actorCaps.botOwner || actorCaps.squishy.sudo
  if (!canImpersonate) {
    return {
      actor,
      viewing: actor,
      botOwner: actorCaps.botOwner,
      squishy: actorCaps.squishy,
      otter: actorCaps.otter,
    }
  }

  // We don't have the impersonated user's username/avatar from the DB
  // path (that comes from Discord). Fill with placeholders — the audit
  // path only needs the ID; UI can re-fetch via a separate user lookup.
  const target: Identity = {
    id: opts.viewAsUserId,
    username: '',
    avatar: null,
  }
  const targetCaps = await resolveFor(target)

  return {
    actor, // always the real user — never overwritten
    viewing: target,
    botOwner: targetCaps.botOwner,
    squishy: targetCaps.squishy,
    otter: targetCaps.otter,
  }
}

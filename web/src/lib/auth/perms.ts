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

function sudoEnvIds(): Set<string> {
  if (!env.SUDO_USER_IDS) return new Set()
  return new Set(
    env.SUDO_USER_IDS.split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  )
}

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
const otterRanksCache = new Map<string, { ranks: Record<string, BusinessRank>; expiresAt: number }>()
const OTTER_RANKS_TTL_MS = 60_000

async function loadOtterBusinesses(userId: string): Promise<Record<string, BusinessRank>> {
  const now = Date.now()
  const cached = otterRanksCache.get(userId)
  if (cached && cached.expiresAt > now) return cached.ranks

  // The previous implementation tried to derive otter ranks from direct
  // SQL — `where m.user_id = $1` on `business_role_mappings`. That column
  // doesn't exist (the table maps role IDs to ranks, not users; manager
  // and employee membership lives EXCLUSIVELY as Discord roles on the
  // member object). The bot's `business.user_ranks` verb walks
  // `guild.members.cache` + `business_role_mappings.role_id` and folds
  // in `business_owners` to return the right rank per business slug.
  try {
    const { callBot } = await import('../botrpc')
    const reply = await callBot<{ ranks: Record<string, string> }>(
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
      return {}
    }
    const out: Record<string, BusinessRank> = {}
    for (const [slug, rank] of Object.entries(reply.data.ranks ?? {})) {
      if (rank === 'owner' || rank === 'manager' || rank === 'employee') {
        out[slug] = rank
      }
    }
    otterRanksCache.set(userId, { ranks: out, expiresAt: now + OTTER_RANKS_TTL_MS })
    return out
  } catch (err) {
    console.warn('[perms] otter businesses lookup failed; returning {}', err)
    return {}
  }
}

/**
 * Resolve the capability map for `subject`. Internal — `resolveAccess` is
 * the public entry that also handles View-As.
 */
async function resolveFor(subject: Identity): Promise<{
  botOwner: boolean
  squishy: AccessMap['squishy']
  otter: AccessMap['otter']
}> {
  // TODO(V2): bot owner === BOT_OWNER_ID OR member of the Discord
  // Application Team (Admins + Developers), resolved over the Redis
  // command bus via `cmd.squishy.team.list`. For now, single-user env.
  const botOwner = subject.id === env.BOT_OWNER_ID

  const envSudo = sudoEnvIds().has(subject.id)
  // TODO(V2): SUDO_ROLE_IDS — needs a Discord member fetch to check
  // roles; deferred until we have the bot RPC for guild member lookup.
  const dbSudo = await checkSudoDb(subject.id)
  const sudo = envSudo || dbSudo

  const [voiceChannels, businesses] = await Promise.all([
    loadVoiceChannels(subject.id),
    loadOtterBusinesses(subject.id),
  ])

  return {
    botOwner,
    squishy: {
      sudo,
      voiceChannels,
      canSelfEdit: true,
    },
    otter: { businesses },
  }
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

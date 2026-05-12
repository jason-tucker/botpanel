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
    const rows = await squishyDb`select 1 from sudo_users where user_id = ${userId} limit 1`
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
    const rows = await squishyDb`
      select voice_channel_id
      from auto_channels
      where owner_user_id = ${userId}
         or acting_owner_user_id = ${userId}
    `
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

async function loadOtterBusinesses(userId: string): Promise<Record<string, BusinessRank>> {
  try {
    const { otterDb } = await import('../db/otter')
    if (!otterDb) return {}
    // role mappings → { slug: rank }
    const mappings = await otterDb`
      select b.slug as slug, m.rank as rank
      from business_role_mappings m
      join businesses b on b.id = m.business_id
      where m.user_id = ${userId}
    `
    const out: Record<string, BusinessRank> = {}
    for (const row of mappings ?? []) {
      const r = row as { slug?: unknown; rank?: unknown }
      if (typeof r.slug !== 'string' || typeof r.rank !== 'string') continue
      if (r.rank === 'owner' || r.rank === 'manager' || r.rank === 'employee') {
        out[r.slug] = r.rank
      }
    }
    // Owner overrides rank — even if a mapping says "manager", explicit
    // ownership wins. Also lets owners appear without a mapping row.
    try {
      const owners = await otterDb`
        select b.slug as slug
        from business_owners o
        join businesses b on b.id = o.business_id
        where o.user_id = ${userId}
      `
      for (const row of owners ?? []) {
        const r = row as { slug?: unknown }
        if (typeof r.slug === 'string') out[r.slug] = 'owner'
      }
    } catch (err) {
      console.warn('[perms] business_owners lookup failed', err)
    }
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

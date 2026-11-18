/**
 * Login guild gate. Decides at the OAuth callback whether a Discord user
 * may sign in to the panel: the bot owner always may; anyone else must be
 * a member of at least one allowed guild (`PANEL_GUILD_IDS`, falling back
 * to `GUILD_ID`). With no allowed guild configured only the bot owner can
 * sign in.
 *
 * Membership comes from Discord's `GET /users/@me/guilds/{id}/member` with
 * the user's own access token (scope `guilds.members.read`), so it works
 * while the bots are down. A 404 or 403 means not a member; a member still
 * in membership screening (`pending: true`) counts as not a member yet.
 * Anything else (network, timeout, 401, 429, 5xx, bad body) is an error:
 * the login is refused with a "try again" message, never treated as a
 * non-member verdict.
 *
 * No `@/` imports so the module stays pure and testable on its own.
 */

export type GuildMembership = 'member' | 'not_member' | 'pending' | 'error'

export type LoginDecision =
  | { allow: true; reason: 'owner' }
  | { allow: true; reason: 'member'; guildId: string }
  | { allow: false; reason: 'not_member' | 'membership_unavailable' | 'no_guild_configured' }

/** Per-call cap on each Discord membership request. */
export const MEMBERSHIP_TIMEOUT_MS = 4_000

type FetchLike = (
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal },
) => Promise<Response>

/**
 * The guilds that admit a login: the parsed `PANEL_GUILD_IDS` list when it
 * has entries, otherwise `GUILD_ID`, otherwise none. Order kept, duplicates
 * dropped.
 */
export function resolveAllowedGuildIds(
  panelGuildIds: readonly string[] | undefined,
  guildId: string | undefined,
): string[] {
  const source = panelGuildIds && panelGuildIds.length > 0 ? panelGuildIds : guildId ? [guildId] : []
  return [...new Set(source)]
}

/** One membership lookup. Never throws; failures map to `'error'`. */
export async function fetchGuildMembership(
  accessToken: string,
  guildId: string,
  fetchImpl: FetchLike = fetch,
  timeoutMs: number = MEMBERSHIP_TIMEOUT_MS,
): Promise<GuildMembership> {
  try {
    const res = await fetchImpl(`https://discord.com/api/users/@me/guilds/${guildId}/member`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (res.status === 404 || res.status === 403) return 'not_member'
    if (!res.ok) {
      console.warn(`[auth.guildGate] Discord member lookup for guild ${guildId} failed: ${res.status}`)
      return 'error'
    }
    const body = (await res.json()) as unknown
    if (!body || typeof body !== 'object') {
      console.warn(`[auth.guildGate] Discord member lookup for guild ${guildId} returned an unexpected body`)
      return 'error'
    }
    return (body as { pending?: unknown }).pending === true ? 'pending' : 'member'
  } catch (err) {
    console.warn(
      `[auth.guildGate] Discord member lookup for guild ${guildId} threw:`,
      err instanceof Error ? err.name : 'unknown error',
    )
    return 'error'
  }
}

/**
 * Pure verdict from the lookups done so far. Owner first; then any member
 * guild allows; then any error means "try again"; otherwise not a member.
 */
export function decideLogin(p: {
  userId: string
  botOwnerId: string
  allowedGuildIds: readonly string[]
  memberships: Readonly<Record<string, GuildMembership>>
}): LoginDecision {
  if (p.userId === p.botOwnerId) return { allow: true, reason: 'owner' }
  if (p.allowedGuildIds.length === 0) return { allow: false, reason: 'no_guild_configured' }
  const member = p.allowedGuildIds.find((g) => p.memberships[g] === 'member')
  if (member) return { allow: true, reason: 'member', guildId: member }
  if (p.allowedGuildIds.some((g) => p.memberships[g] === 'error' || p.memberships[g] === undefined)) {
    return { allow: false, reason: 'membership_unavailable' }
  }
  return { allow: false, reason: 'not_member' }
}

/**
 * Runs the gate: owner short-circuits with no Discord calls; otherwise the
 * allowed guilds are checked in order, stopping at the first membership.
 */
export async function checkLoginAccess(p: {
  userId: string
  botOwnerId: string
  allowedGuildIds: readonly string[]
  accessToken: string
  fetchImpl?: FetchLike
  timeoutMs?: number
}): Promise<{ decision: LoginDecision; memberships: Record<string, GuildMembership> }> {
  const memberships: Record<string, GuildMembership> = {}
  if (p.userId !== p.botOwnerId) {
    for (const guildId of p.allowedGuildIds) {
      memberships[guildId] = await fetchGuildMembership(p.accessToken, guildId, p.fetchImpl, p.timeoutMs)
      if (memberships[guildId] === 'member') break
    }
  }
  return {
    decision: decideLogin({
      userId: p.userId,
      botOwnerId: p.botOwnerId,
      allowedGuildIds: p.allowedGuildIds,
      memberships,
    }),
    memberships,
  }
}

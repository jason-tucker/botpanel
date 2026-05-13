import { env } from '@/lib/env'

const SCOPES = ['identify', 'guilds', 'guilds.members.read'] as const

export function authorizeUrl(state: string): string {
  if (!env.DISCORD_CLIENT_ID || !env.PUBLIC_BASE_URL) {
    throw new Error('Discord OAuth not configured — set DISCORD_CLIENT_ID and PUBLIC_BASE_URL')
  }
  const params = new URLSearchParams({
    client_id: env.DISCORD_CLIENT_ID,
    redirect_uri: `${env.PUBLIC_BASE_URL}/api/auth/callback`,
    response_type: 'code',
    scope: SCOPES.join(' '),
    state,
    // `prompt=consent` forces Discord to show the consent screen every
    // time. Without `prompt` Discord skips consent for users who've
    // already authorized once; we keep `consent` so first-time visitors
    // ALWAYS see the screen rather than getting silently bounced when
    // the prior code (`prompt=none`) would have refused without
    // pre-existing authorization.
    prompt: 'consent',
  })
  return `https://discord.com/api/oauth2/authorize?${params.toString()}`
}

export interface DiscordTokenResponse {
  access_token: string
  token_type: string
  expires_in: number
  refresh_token: string
  scope: string
}

export async function exchangeCode(code: string): Promise<DiscordTokenResponse> {
  if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET || !env.PUBLIC_BASE_URL) {
    throw new Error('Discord OAuth not configured')
  }
  const body = new URLSearchParams({
    client_id: env.DISCORD_CLIENT_ID,
    client_secret: env.DISCORD_CLIENT_SECRET,
    grant_type: 'authorization_code',
    code,
    redirect_uri: `${env.PUBLIC_BASE_URL}/api/auth/callback`,
  })
  const res = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '<no body>')
    throw new Error(`Discord token exchange failed: ${res.status} ${text}`)
  }
  return res.json() as Promise<DiscordTokenResponse>
}

export interface DiscordUser {
  id: string
  username: string
  global_name: string | null
  avatar: string | null
}

export async function fetchMe(accessToken: string): Promise<DiscordUser> {
  const res = await fetch('https://discord.com/api/users/@me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) throw new Error(`Discord /users/@me failed: ${res.status}`)
  return res.json() as Promise<DiscordUser>
}

/**
 * Fetch the user's guild memberships via the `guilds` OAuth scope and
 * return just the IDs. Used at login to seed `session.guildIds` so the
 * sidebar can hide bot-specific nav for users who aren't in the relevant
 * guild.
 *
 * Non-throwing — Discord's /guilds endpoint occasionally returns 429 or
 * a transient 5xx and we'd rather log the user in with no guild data
 * (sidebar falls back to the existing capability flags) than fail the
 * whole login. Returns `[]` on any failure.
 *
 * Bots that don't share a guild with the user still won't grant any
 * panel capability — the existing `resolveAccess` gates are the source
 * of truth for authorization. `guildIds` is purely a UI hint.
 */
export async function fetchGuildIds(accessToken: string): Promise<string[]> {
  try {
    const res = await fetch('https://discord.com/api/users/@me/guilds', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) {
      console.warn(`Discord /users/@me/guilds failed: ${res.status}`)
      return []
    }
    const data = (await res.json()) as Array<{ id?: unknown }>
    const ids: string[] = []
    for (const g of data) {
      if (g && typeof g.id === 'string') ids.push(g.id)
    }
    return ids
  } catch (err) {
    console.warn('Discord /users/@me/guilds threw', err)
    return []
  }
}

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { exchangeCode, fetchMe, fetchGuildIds } from '@/lib/auth/discord'
import { mintSession, setSessionCookie } from '@/lib/auth/session'
import { env } from '@/lib/env'

export const dynamic = 'force-dynamic'

/**
 * Returns the canonical home URL for this clone. We don't use `req.url`'s
 * origin because behind Caddy the upstream sees `HOSTNAME:PORT` (e.g.
 * `http://0.0.0.0:3000`), not the public address — using it would redirect
 * the user back to the internal Next listen address. `PUBLIC_BASE_URL` is
 * already required for OAuth to work, so it's safe to rely on.
 */
function homeUrl(qs = ''): string {
  const base = (env.PUBLIC_BASE_URL ?? '').replace(/\/$/, '')
  return base + '/' + qs
}

/** GET /api/auth/callback?code=...&state=... */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  if (!code || !state) {
    return NextResponse.redirect(homeUrl('?error=missing_params'))
  }

  // Verify state against the single-use cookie set in /api/auth/login.
  const c = await cookies()
  const expected = c.get('__Host-oauth-state')?.value
  c.delete('__Host-oauth-state')
  if (!expected || expected !== state) {
    return NextResponse.redirect(homeUrl('?error=bad_state'))
  }

  try {
    const tokens = await exchangeCode(code)
    // Identity + guild-membership in parallel — both reads use the same
    // access token and the bot/login can tolerate either independently
    // failing (fetchGuildIds returns [] on its own errors).
    const [user, guildIds] = await Promise.all([
      fetchMe(tokens.access_token),
      fetchGuildIds(tokens.access_token),
    ])
    const token = await mintSession({
      id: user.id,
      username: user.global_name ?? user.username,
      global_name: user.global_name,
      avatar: user.avatar,
      // Captured at login; readers treat as a UI hint (sidebar gates),
      // never as an authorization grant. Stays in the JWT for the
      // 3-day TTL — users moving in/out of guilds within that window
      // just see slightly stale sidebar gating until they log back in.
      guildIds,
    })
    await setSessionCookie(token)
    return NextResponse.redirect(homeUrl())
  } catch (err) {
    console.error('OAuth callback failed:', err)
    return NextResponse.redirect(homeUrl('?error=callback_failed'))
  }
}

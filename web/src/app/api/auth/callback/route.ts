import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { exchangeCode, fetchMe, fetchGuildIds } from '@/lib/auth/discord'
import { mintSession, setSessionCookie, newJti } from '@/lib/auth/session'
import { encryptToken } from '@/lib/auth/tokenCrypto'
import { sessions as panelSessions } from '@/lib/db/schema/panel'
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
    // Mint a server-side session id, then encrypt + persist the refresh
    // token under it. Best-effort: a DB failure here (or a missing
    // `OAUTH_TOKEN_KEY`) MUST NOT block login — we'll log a warning and
    // proceed with the JWT-only flow. The follow-up cost is just that
    // we can't refresh access tokens silently for this user; they'll
    // re-OAuth when their access token expires.
    const jti = newJti()
    try {
      if (env.OAUTH_TOKEN_KEY && env.SQUISHY_DATABASE_URL) {
        const enc = encryptToken(tokens.refresh_token)
        const { squishyDb } = await import('@/lib/db/squishy')
        await squishyDb.insert(panelSessions).values({
          id: jti,
          userId: user.id,
          refreshTokenCiphertext: enc.ciphertext,
          refreshTokenIv: enc.iv,
          refreshTokenTag: enc.tag,
          refreshTokenKeyVersion: enc.keyVersion,
        })
      } else {
        console.warn(
          '[auth.callback] OAUTH_TOKEN_KEY or SQUISHY_DATABASE_URL not set — skipping refresh-token persistence',
        )
      }
    } catch (err) {
      // Don't surface to the user; the JWT cookie still authenticates
      // them for this session's 3-day TTL. Operators will see this in
      // logs and can fix the DB or env without disrupting users.
      console.warn('[auth.callback] failed to persist encrypted refresh token (non-fatal)', err)
    }
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
      jti,
    })
    await setSessionCookie(token)
    return NextResponse.redirect(homeUrl())
  } catch (err) {
    console.error('OAuth callback failed:', err)
    return NextResponse.redirect(homeUrl('?error=callback_failed'))
  }
}

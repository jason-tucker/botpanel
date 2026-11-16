import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { sql } from 'drizzle-orm'
import { writeAudit } from '@/lib/audit'
import { exchangeCode, fetchMe, fetchGuildIds } from '@/lib/auth/discord'
import { mintSession, setSessionCookie, newJti, seedSession } from '@/lib/auth/session'
import { checkLoginAccess, resolveAllowedGuildIds } from '@/lib/auth/guildGate'
import { encryptToken } from '@/lib/auth/tokenCrypto'
import { sessions as panelSessions } from '@/lib/db/schema/panel'
import { env } from '@/lib/env'

export const dynamic = 'force-dynamic'

/** Longest the login waits for the lazy CREATE TABLE before trying the insert. */
const ENSURE_TABLE_WAIT_MS = 2_000

/** The "no allowed guild configured" warning is logged once per process. */
let warnedNoGuildConfigured = false

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
  // Clear the single-use state cookie by overwriting with an expired one — NOT
  // `c.delete()`, which omits Secure/Path and is rejected for `__Host-` cookies
  // (same gotcha as session/view-as clears). Harmless here since it also has a
  // 10-min maxAge, but kept consistent so the antipattern doesn't get copied.
  c.set('__Host-oauth-state', '', {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  })
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
    const actor = { id: user.id, username: user.global_name ?? user.username }
    // Guild gate: only the bot owner, or a member of an allowed guild, gets
    // a session. Checked before any session row or cookie exists.
    const allowedGuildIds = resolveAllowedGuildIds(env.PANEL_GUILD_IDS, env.GUILD_ID)
    const { decision, memberships } = await checkLoginAccess({
      userId: user.id,
      botOwnerId: env.BOT_OWNER_ID,
      allowedGuildIds,
      accessToken: tokens.access_token,
    })
    if (!decision.allow) {
      if (decision.reason === 'no_guild_configured' && !warnedNoGuildConfigured) {
        warnedNoGuildConfigured = true
        console.error(
          '[auth.callback] Neither PANEL_GUILD_IDS nor GUILD_ID is set: only BOT_OWNER_ID can sign in to the panel.',
        )
      }
      await writeAudit({
        bot: 'squishy',
        actor,
        viewing: actor,
        action: 'auth.login_denied',
        targetType: 'panel_sessions',
        targetId: null,
        after: { reason: decision.reason, memberships },
        success: false,
        errorMessage: decision.reason,
      })
      return NextResponse.redirect(homeUrl(`?error=${decision.reason}`))
    }
    // Mint a server-side session id and record it in `panel_sessions`.
    // getSession() requires that row whenever the session store
    // (SQUISHY_DATABASE_URL) is configured, so the insert is mandatory
    // there: if it fails we set no cookie rather than hand out a session
    // that would read as logged out. The encrypted refresh token is
    // optional — without OAUTH_TOKEN_KEY (or if encryption fails) the row
    // is written with those columns NULL and login still works.
    const jti = newJti()
    if (env.SQUISHY_DATABASE_URL) {
      let enc: ReturnType<typeof encryptToken> | null = null
      if (env.OAUTH_TOKEN_KEY) {
        try {
          enc = encryptToken(tokens.refresh_token)
        } catch (err) {
          console.warn('[auth.callback] refresh-token encryption failed; storing the session without it', err)
        }
      } else {
        console.warn('[auth.callback] OAUTH_TOKEN_KEY not set — session stored without a refresh token')
      }
      try {
        const [{ squishyDb }, { ensurePanelSessionsTable }] = await Promise.all([
          import('@/lib/db/squishy'),
          import('@/lib/db/panelSessions'),
        ])
        // Lazy create on a fresh deploy (never throws; the insert decides),
        // waited on for at most ENSURE_TABLE_WAIT_MS.
        let ensureTimer: ReturnType<typeof setTimeout> | undefined
        await Promise.race([
          ensurePanelSessionsTable(),
          new Promise<void>((res) => {
            ensureTimer = setTimeout(res, ENSURE_TABLE_WAIT_MS)
          }),
        ]).finally(() => clearTimeout(ensureTimer))
        await squishyDb.insert(panelSessions).values({
          id: jti,
          userId: user.id,
          ...(enc
            ? {
                refreshTokenCiphertext: enc.ciphertext,
                refreshTokenIv: enc.iv,
                refreshTokenTag: enc.tag,
                refreshTokenKeyVersion: enc.keyVersion,
              }
            : {}),
        })
        // This process now knows the row exists: the first requests after
        // login read as signed in even during a lookup back-off.
        seedSession(jti, user.id)
      } catch (err) {
        const { dbErrorText } = await import('@/lib/db/panelSessions')
        console.error('[auth.callback] failed to store the session row; login refused:', dbErrorText(err))
        await writeAudit({
          bot: 'squishy',
          actor,
          viewing: actor,
          action: 'auth.login',
          targetType: 'panel_sessions',
          targetId: null,
          success: false,
          errorMessage: 'session_store_unavailable',
        })
        return NextResponse.redirect(homeUrl('?error=session_store_unavailable'))
      }
      // Best-effort purge of rows past the JWT TTL; never blocks login.
      void (async () => {
        const [{ squishyDb }, { dbErrorText }] = await Promise.all([
          import('@/lib/db/squishy'),
          import('@/lib/db/panelSessions'),
        ])
        try {
          await squishyDb
            .delete(panelSessions)
            .where(sql`${panelSessions.createdAt} < now() - interval '3 days'`)
        } catch (err) {
          console.warn('[auth.callback] expired-session purge failed (non-fatal):', dbErrorText(err))
        }
      })().catch(() => {
        // Only the two module loads can land here; both already succeeded
        // above, so there is nothing worth logging.
      })
    } else {
      console.warn('[auth.callback] SQUISHY_DATABASE_URL not set — no session row; revocation disabled')
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
    await writeAudit({
      bot: 'squishy',
      actor,
      viewing: actor,
      action: 'auth.login',
      targetType: 'panel_sessions',
      targetId: null,
      success: true,
    })
    return NextResponse.redirect(homeUrl())
  } catch (err) {
    console.error('OAuth callback failed:', err)
    return NextResponse.redirect(homeUrl('?error=callback_failed'))
  }
}

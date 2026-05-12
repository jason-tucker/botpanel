import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { exchangeCode, fetchMe } from '@/lib/auth/discord'
import { mintSession, setSessionCookie } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'

/** GET /api/auth/callback?code=...&state=... */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  if (!code || !state) {
    return NextResponse.redirect(new URL('/?error=missing_params', url.origin))
  }

  // Verify state against the single-use cookie set in /api/auth/login.
  const c = await cookies()
  const expected = c.get('__Host-oauth-state')?.value
  c.delete('__Host-oauth-state')
  if (!expected || expected !== state) {
    return NextResponse.redirect(new URL('/?error=bad_state', url.origin))
  }

  try {
    const tokens = await exchangeCode(code)
    const user = await fetchMe(tokens.access_token)
    const token = await mintSession({
      id: user.id,
      username: user.global_name ?? user.username,
      global_name: user.global_name,
      avatar: user.avatar,
    })
    await setSessionCookie(token)
    return NextResponse.redirect(new URL('/', url.origin))
  } catch (err) {
    console.error('OAuth callback failed:', err)
    return NextResponse.redirect(new URL('/?error=callback_failed', url.origin))
  }
}

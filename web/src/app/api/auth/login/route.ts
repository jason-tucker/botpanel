import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { authorizeUrl } from '@/lib/auth/discord'
import { randomBytes } from 'node:crypto'

export const dynamic = 'force-dynamic'

/** GET /api/auth/login → redirect to Discord OAuth with a single-use `state`. */
export async function GET() {
  try {
    const state = randomBytes(24).toString('hex')
    const c = await cookies()
    c.set('__Host-oauth-state', state, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 600,  // 10 min — single-use, short window
    })
    return NextResponse.redirect(authorizeUrl(state))
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 503 })
  }
}

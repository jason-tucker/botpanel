import { NextResponse } from 'next/server'
import { clearSessionCookie } from '@/lib/auth/session'
import { env } from '@/lib/env'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  await clearSessionCookie()
  // Behind Caddy `req.url` carries the internal origin (next:3000), so the
  // public origin comes from PUBLIC_BASE_URL. The request origin is only a
  // fallback for local dev where the env var is unset.
  const base = env.PUBLIC_BASE_URL ?? new URL(req.url).origin
  return NextResponse.redirect(new URL('/', base), 303)
}

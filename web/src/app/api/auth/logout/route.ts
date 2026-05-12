import { NextResponse } from 'next/server'
import { clearSessionCookie } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  await clearSessionCookie()
  return NextResponse.redirect(new URL('/', new URL(req.url).origin), 303)
}

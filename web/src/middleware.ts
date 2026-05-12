import { NextResponse, type NextRequest } from 'next/server'

/**
 * Root middleware — runs at the Edge, before any page handler. Sole job:
 * if a protected path is requested without a session cookie, bounce to
 * `/`. We deliberately do NOT call `resolveAccess()` here — per-request
 * DB hits in middleware are expensive and turn every page into a chain
 * of round-trips. Authorization (capability checks) happens in the
 * route handler / page layout via `withAuth` or `resolveAccess`.
 */

const SESSION_COOKIE = '__Host-session'

export function middleware(req: NextRequest) {
  const hasCookie = req.cookies.has(SESSION_COOKIE)
  if (hasCookie) return NextResponse.next()
  const url = req.nextUrl.clone()
  url.pathname = '/'
  url.search = ''
  return NextResponse.redirect(url)
}

export const config = {
  matcher: ['/squishy/:path*', '/otter/:path*', '/sudo/:path*', '/me'],
}

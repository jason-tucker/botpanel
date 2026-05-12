/**
 * /me/edit — convenience wrapper that redirects to the user's own profile
 * editor. The actual editor lives at /squishy/profiles/[id]/edit because
 * the surface is the same regardless of who's editing (sudo or self) — we
 * just want a memorable URL for self-service that doesn't require the user
 * to know their own Discord snowflake.
 *
 * Logged out → bounce to login.
 */
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export default async function MeEditRedirect() {
  const session = await getSession()
  if (!session) redirect('/api/auth/login')
  redirect(`/squishy/profiles/${session.id}/edit`)
}

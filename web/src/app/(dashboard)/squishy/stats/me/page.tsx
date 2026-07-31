/**
 * /squishy/stats/me — redirect shim to the viewer's own activity page.
 *
 * Exists so the ungated Overview "You" nav group (visible to every logged-in
 * member, not just sudo) has a stable link that works regardless of View-As
 * state — it always resolves to `access.viewing.id`, which is the real
 * viewer unless a sudo has View-As active, matching every other
 * `/me/*`-style entry point in the panel.
 */
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/session'
import { resolveAccess } from '@/lib/auth/perms'
import { getViewAsUserId } from '@/lib/auth/viewAs'

export const dynamic = 'force-dynamic'

export default async function SquishyStatsMePage() {
  const session = await getSession()
  if (!session) redirect('/')

  const viewAsUserId = await getViewAsUserId()
  const access = await resolveAccess(session, viewAsUserId ? { viewAsUserId } : undefined)

  redirect(`/squishy/stats/users/${access.viewing.id}`)
}

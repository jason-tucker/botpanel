/**
 * /otter/move-channel — manager+ panel mirror of `/movechannel`.
 *
 * Server component:
 *  - Gates on "manager+ of at least one active otter business OR sudo".
 *    Same posture as the slash command.
 *  - Mounts `<MoveChannelForm>`, a client island with two ChannelPickers
 *    (any channel type / category-only) + a top/bottom radio.
 */
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/session'
import { resolveAccess } from '@/lib/auth/perms'
import { MoveChannelForm } from './MoveChannelForm'

export const dynamic = 'force-dynamic'

export default async function MoveChannelPage() {
  const session = await getSession()
  if (!session) redirect('/api/auth/login')
  const access = await resolveAccess(session)

  const isManagerSomewhere = Object.values(access.otter.businesses).some(
    (rank) => rank === 'manager' || rank === 'owner',
  )
  const allowed = isManagerSomewhere || access.botOwner

  if (!allowed) {
    return (
      <main className="min-h-dvh p-6 sm:p-10">
        <div className="max-w-md mx-auto rounded-2xl border border-line bg-bg-card p-6 flex flex-col gap-3">
          <h1 className="text-xl font-semibold">Manager only</h1>
          <p className="text-ink-dim text-sm">
            Moving channels is restricted to managers + of at least one active
            business (or sudo). If you need to move a channel, ping a manager
            of the relevant business.
          </p>
          <Link href="/me" className="text-sm text-accent underline self-start">
            ← Back to dashboard
          </Link>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-dvh p-6 sm:p-10 pt-16 md:pt-10">
      <div className="max-w-2xl mx-auto flex flex-col gap-6">
        <header>
          <h1 className="text-2xl font-semibold">
            <code className="font-mono">/movechannel</code>
          </h1>
          <p className="text-sm text-ink-dim mt-1 max-w-2xl">
            Move a channel to a different category. Same authorization as the
            slash command — manager+ of at least one active business, or sudo.
            Existing channel permissions are preserved (no <code>lockPermissions</code>).
          </p>
        </header>

        <MoveChannelForm />
      </div>
    </main>
  )
}

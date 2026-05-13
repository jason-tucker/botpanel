/**
 * /squishy/members — sudo browser for every guild member.
 *
 * Server component. Sudo / bot-owner only; everyone else gets a 403 card.
 * The actual list + search live in a client island (`./MembersBrowser`)
 * that hits `/api/squishy/meta/members` for the typeahead — same endpoint
 * the existing `<MemberPicker>` uses.
 *
 * Clicking any row navigates to `/squishy/members/[id]` for the per-user
 * drill-down (every per-user setting in one place).
 */
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/session'
import { resolveAccess } from '@/lib/auth/perms'
import { MembersBrowser } from './MembersBrowser'

export const dynamic = 'force-dynamic'

function ForbiddenCard() {
  return (
    <main className="min-h-dvh p-6 sm:p-10">
      <div className="max-w-md mx-auto rounded-2xl border border-line bg-bg-card p-6 flex flex-col gap-3">
        <h1 className="text-xl font-semibold">403 — Not allowed</h1>
        <p className="text-ink-dim text-sm">
          The Members editor is sudo-only — it lets sudo edit every
          per-user setting (profile, games, sudo bit, staff roles, voice
          presence, color role) for any guild member. Ask the bot owner
          to add you to <code className="font-mono text-xs">SUDO_USER_IDS</code>
          {' '}or the <code className="font-mono text-xs">sudo_users</code>
          {' '}table.
        </p>
      </div>
    </main>
  )
}

export default async function MembersIndexPage() {
  const session = await getSession()
  if (!session) redirect('/api/auth/login')

  const access = await resolveAccess(session)
  const canView = access.botOwner || access.squishy.sudo
  if (!canView) return <ForbiddenCard />

  return (
    <main className="min-h-dvh p-6 sm:p-10 pt-16 md:pt-10">
      <div className="max-w-4xl mx-auto flex flex-col gap-6">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">Members</h1>
          <p className="text-sm text-ink-dim">
            Browse every guild member; click any to manage their settings
            from one place — profile, game prefs, sudo bit, staff roles,
            voice presence, and color role.
          </p>
        </header>

        <MembersBrowser />
      </div>
    </main>
  )
}

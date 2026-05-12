/**
 * /audit — unified live audit tail for sudo+ viewers.
 *
 * Server side: get the session, resolve the full capability map, and gate
 * on `sudo` (Squishy sudo OR bot owner). Otter-only staff don't see this
 * view in MVP — too much surface to filter cleanly, and their portal pages
 * will eventually show a per-business audit slice instead. If the viewer
 * fails the gate we render a friendly 403 card in place of a redirect so
 * the URL stays linkable and they can sign in differently if needed.
 *
 * The actual table + EventSource lives in the client child below.
 *
 * Layout note: this page lives under the `(dashboard)` route group, so
 * the sidebar + outer `<main>` are owned by the layout — we render a plain
 * `<div>` here and skip the redundant "← Dashboard" back-link.
 */
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/session'
import { resolveAccess } from '@/lib/auth/perms'
import { AuditLive } from './AuditLive'

export const dynamic = 'force-dynamic'

export default async function AuditPage() {
  const session = await getSession()
  if (!session) redirect('/api/auth/login')

  const access = await resolveAccess(session)
  const canView = access.botOwner || access.squishy.sudo

  if (!canView) {
    return (
      <div className="p-6 sm:p-10 pt-16 md:pt-10">
        <div className="max-w-md mx-auto rounded-2xl border border-line bg-bg-card p-6 flex flex-col gap-3">
          <h1 className="text-xl font-semibold">403 — Not allowed</h1>
          <p className="text-ink-dim text-sm">
            The unified audit tail is sudo-only. If you think you should have
            access, ask the bot owner to add your Discord ID to{' '}
            <code className="font-mono text-xs">SUDO_USER_IDS</code> or the{' '}
            <code className="font-mono text-xs">sudo_users</code> table.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 sm:p-10 pt-16 md:pt-10">
      <div className="max-w-6xl mx-auto flex flex-col gap-6">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">Audit tail</h1>
          <p className="text-sm text-ink-dim">
            Live stream of every Squishy setting change and every Otter
            audit write. The last 50 entries load on mount; new entries
            stream in via SSE.
          </p>
        </header>

        <AuditLive />
      </div>
    </div>
  )
}

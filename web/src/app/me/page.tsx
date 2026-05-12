import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/session'
import { env } from '@/lib/env'

export const dynamic = 'force-dynamic'

export default async function MePage() {
  const session = await getSession()
  if (!session) redirect('/api/auth/login')

  const isBotOwner = session.id === env.BOT_OWNER_ID

  return (
    <main className="min-h-dvh p-6 sm:p-10">
      <div className="max-w-3xl mx-auto flex flex-col gap-6">
        <header className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <form action="/api/auth/logout" method="POST">
            <button type="submit" className="text-sm text-ink-dim hover:text-ink">Sign out</button>
          </form>
        </header>

        <section className="rounded-2xl border border-line bg-bg-card p-5 flex flex-col gap-3">
          <div className="text-xs uppercase tracking-wider text-ink-dim">Signed in</div>
          <div className="font-medium text-lg">{session.username}</div>
          <div className="text-sm text-ink-dim font-mono">{session.id}</div>
          {isBotOwner && (
            <div className="inline-flex items-center gap-2 self-start mt-1 rounded-full bg-bg-card2 border border-line px-3 py-1 text-xs">
              <span className="w-2 h-2 rounded-full bg-ok" /> Bot owner
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-line bg-bg-card p-5">
          <h2 className="text-xs uppercase tracking-wider text-ink-dim mb-3">Status</h2>
          <p className="text-ink-dim">
            This is the dashboard foundation. Read-only views for both bots, live presence, and audit log
            tails are landing in MVP. See the{' '}
            <Link href="https://github.com/jason-tucker/botpanel/wiki/Roadmap" className="text-accent underline">
              roadmap
            </Link>
            .
          </p>
        </section>

        <footer className="text-xs text-ink-dim text-center">
          build <code className="font-mono">{env.GIT_SHA}</code>
        </footer>
      </div>
    </main>
  )
}

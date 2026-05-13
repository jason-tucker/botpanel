/**
 * /squishy/cleanup — sudo orphan-scan + cleanup page.
 *
 * Mirrors the `/sudo → Force cleanup` slash button. Two-step flow:
 *   1. Click "Scan for orphans" → walks the four bot-managed tables and
 *      lists rows whose Discord references are missing.
 *   2. Click "Clean up orphan rows" → deletes the entirely-orphan rows.
 *      Rows with PARTIALLY-missing references are left alone (the user
 *      repairs those through the Games panel).
 *
 * Bot-owner gate — both verbs are owner-only on the bot side.
 */
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/session'
import { resolveAccess } from '@/lib/auth/perms'
import { CleanupCard } from './CleanupCard'

export const dynamic = 'force-dynamic'

export default async function CleanupPage() {
  const session = await getSession()
  if (!session) redirect('/api/auth/login')
  const access = await resolveAccess(session)

  if (!access.botOwner) {
    return (
      <main className="min-h-dvh p-6 sm:p-10">
        <div className="max-w-md mx-auto rounded-2xl border border-line bg-bg-card p-6 flex flex-col gap-3">
          <h1 className="text-xl font-semibold">Bot-owner only</h1>
          <p className="text-ink-dim text-sm">
            Orphan-cleanup deletes rows from the bot&apos;s tables (auto-
            channels, hubs, auto-threads, archives). Bot-owner only.
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
      <div className="max-w-3xl mx-auto flex flex-col gap-6">
        <header>
          <h1 className="text-2xl font-semibold">
            <code className="font-mono">/sudo</code> → Force Cleanup
          </h1>
          <p className="text-sm text-ink-dim mt-1 max-w-2xl">
            Scan for and remove orphaned rows in the bot&apos;s tables
            (auto-channels, hubs, auto-threads, archives) whose Discord
            references no longer exist. Rows with partially-missing references
            are left alone — those repair through the Games panel.
          </p>
        </header>

        <CleanupCard />
      </div>
    </main>
  )
}

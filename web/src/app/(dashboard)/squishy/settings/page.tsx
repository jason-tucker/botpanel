/**
 * /squishy/settings — read-only viewer for the `bot_settings` table.
 *
 * Server component:
 *  - Verifies a session (Edge middleware already redirects un-authed visits,
 *    but we re-check here so a stale build can never accidentally render an
 *    authed shell to a logged-out viewer).
 *  - Resolves the full AccessMap. Sudo or bot-owner can view; everyone else
 *    sees a 403 card (URL stays linkable for sharing).
 *  - Reads `bot_settings` directly via the typed Drizzle query — no need to
 *    hop through the API route from the same Node process. The API at
 *    `/api/squishy/settings` exists for client tooling only.
 *  - DB unreachable → render with an empty list + an inline banner explaining
 *    why. We never 500 on a downed DB.
 *  - Hands the rows to a small client component (`<SettingsView />`) so the
 *    namespace-search filter can run interactively without a round-trip.
 *
 * This page lives in the `(dashboard)` route group so the shared nav (built
 * by a parallel agent) wraps it once it lands. The group is a no-op when the
 * `(dashboard)/layout.tsx` doesn't exist yet — Next.js just renders the
 * page with the root layout.
 */
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { asc } from 'drizzle-orm'
import { getSession } from '@/lib/auth/session'
import { resolveAccess } from '@/lib/auth/perms'
import { squishyDb, squishySchema } from '@/lib/db/squishy'
import { SettingsView, type SettingRow } from './SettingsView'

export const dynamic = 'force-dynamic'

async function loadSettings(): Promise<{
  rows: SettingRow[]
  error: 'db-unavailable' | null
}> {
  try {
    const result = await squishyDb
      .select()
      .from(squishySchema.botSettings)
      .orderBy(asc(squishySchema.botSettings.key))

    const rows: SettingRow[] = result.map((r) => ({
      key: r.key,
      value: r.value,
      updatedByDiscordId: r.updatedByDiscordId,
      updatedAt:
        r.updatedAt instanceof Date
          ? r.updatedAt.toISOString()
          : String(r.updatedAt),
    }))
    return { rows, error: null }
  } catch (err) {
    console.warn('[squishy/settings page] DB unreachable; rendering empty', err)
    return { rows: [], error: 'db-unavailable' }
  }
}

export default async function SquishySettingsPage() {
  const session = await getSession()
  if (!session) redirect('/api/auth/login')

  const access = await resolveAccess(session)
  const allowed = access.squishy.sudo || access.botOwner

  if (!allowed) {
    return (
      <main className="min-h-dvh p-6 sm:p-10">
        <div className="max-w-md mx-auto rounded-2xl border border-line bg-bg-card p-6 flex flex-col gap-3">
          <h1 className="text-xl font-semibold">Not authorized</h1>
          <p className="text-ink-dim text-sm">
            The bot settings viewer is restricted to Squishy sudo users and
            the bot owner. If you think you should have access, ask the bot
            owner to add your Discord ID to{' '}
            <code className="font-mono text-xs">SUDO_USER_IDS</code> or the{' '}
            <code className="font-mono text-xs">sudo_users</code> table.
          </p>
          <Link href="/me" className="text-sm text-accent underline self-start">
            ← Back to dashboard
          </Link>
        </div>
      </main>
    )
  }

  const { rows, error } = await loadSettings()

  return (
    <main className="min-h-dvh p-6 sm:p-10">
      <div className="max-w-5xl mx-auto flex flex-col gap-6">
        <header className="flex items-center justify-between">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold">Bot settings</h1>
            <p className="text-sm text-ink-dim">
              Read-only dump of every row in{' '}
              <code className="font-mono text-xs">bot_settings</code>. Grouped
              by namespace (first dot-segment of the key). Sudo + bot-owner
              viewers can edit values inline; everyone else gets read-only.
            </p>
          </div>
          <Link href="/me" className="text-sm text-ink-dim hover:text-ink">
            ← Dashboard
          </Link>
        </header>

        {error === 'db-unavailable' && (
          <div className="rounded-xl border border-line bg-bg-card p-3 text-xs text-warn">
            Squishy DB is unreachable — showing an empty list. Settings will
            populate once Postgres is back.
          </div>
        )}

        <SettingsView settings={rows} canEdit={allowed} />
      </div>
    </main>
  )
}

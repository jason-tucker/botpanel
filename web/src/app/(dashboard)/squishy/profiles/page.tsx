/**
 * /squishy/profiles — read-only User Profiles directory.
 *
 * Server component. Sudo-gated (Squishy sudo OR bot owner). Lists every row
 * in `user_profiles` ordered by `updated_at desc`, capped at 200 for safety.
 * URL-driven substring search (`?q=…`) filters on `user_id ILIKE` OR
 * `display_name ILIKE` so links are shareable and there's no client state.
 *
 * Each row links to `/squishy/profiles/<userId>` for the detail view. We use
 * `userId` (not the row's `id` UUID) because that's the natural identifier
 * staff cite when troubleshooting, and the detail page can look up the row
 * by `user_id + guild_id`.
 *
 * Edit is V2 — this view is intentionally read-only.
 */
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { desc, or, ilike, sql } from 'drizzle-orm'
import { getSession } from '@/lib/auth/session'
import { resolveAccess } from '@/lib/auth/perms'
import { squishyDb } from '@/lib/db/squishy'
import { userProfiles } from '@/lib/db/schema/squishy'
import { relTime } from '@/lib/util/format'

export const dynamic = 'force-dynamic'

const ROW_CAP = 200

type ProfileRow = {
  id: string
  userId: string
  displayName: string | null
  birthdayMonth: number | null
  birthdayDay: number | null
  staffCategory: string | null
  updatedAt: Date
}

async function loadProfiles(q: string | null): Promise<ProfileRow[] | null> {
  try {
    const base = squishyDb
      .select({
        id: userProfiles.id,
        userId: userProfiles.userId,
        displayName: userProfiles.displayName,
        birthdayMonth: userProfiles.birthdayMonth,
        birthdayDay: userProfiles.birthdayDay,
        staffCategory: userProfiles.staffCategory,
        updatedAt: userProfiles.updatedAt,
      })
      .from(userProfiles)

    const rows = q
      ? await base
          .where(
            or(
              ilike(userProfiles.userId, `%${q}%`),
              ilike(sql`coalesce(${userProfiles.displayName}, '')`, `%${q}%`),
            ),
          )
          .orderBy(desc(userProfiles.updatedAt))
          .limit(ROW_CAP)
      : await base.orderBy(desc(userProfiles.updatedAt)).limit(ROW_CAP)

    return rows
  } catch (err) {
    console.warn('[squishy/profiles] list load failed', err)
    return null
  }
}

function hasBirthday(row: ProfileRow): boolean {
  return row.birthdayMonth != null && row.birthdayDay != null
}

export default async function SquishyProfilesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const session = await getSession()
  if (!session) redirect('/api/auth/login')

  const access = await resolveAccess(session)
  const allowed = access.botOwner || access.squishy.sudo

  if (!allowed) {
    return (
      <main className="min-h-dvh p-6 sm:p-10">
        <div className="max-w-md mx-auto rounded-2xl border border-line bg-bg-card p-6 flex flex-col gap-3">
          <h1 className="text-xl font-semibold">403 — Not allowed</h1>
          <p className="text-ink-dim text-sm">
            User profiles directory is sudo-only. Ask the bot owner to add your
            Discord ID to <code className="font-mono text-xs">SUDO_USER_IDS</code>{' '}
            or the <code className="font-mono text-xs">sudo_users</code> table.
          </p>
          <Link href="/me" className="text-sm text-accent underline self-start">
            ← Back to dashboard
          </Link>
        </div>
      </main>
    )
  }

  const sp = await searchParams
  const q = (sp.q ?? '').trim() || null
  const list = await loadProfiles(q)

  return (
    <main className="min-h-dvh p-6 sm:p-10">
      <div className="max-w-6xl mx-auto flex flex-col gap-6">
        <header className="flex items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold">User profiles</h1>
            <p className="text-sm text-ink-dim">
              Read-only directory of every saved profile. Search by Discord ID
              or display name. Edit comes in V2.
            </p>
          </div>
          <Link href="/me" className="text-sm text-ink-dim hover:text-ink whitespace-nowrap">
            ← Dashboard
          </Link>
        </header>

        <form
          action="/squishy/profiles"
          method="GET"
          className="flex items-center gap-2"
        >
          <input
            type="text"
            name="q"
            defaultValue={q ?? ''}
            placeholder="Search by user ID or display name…"
            className="flex-1 rounded-lg border border-line bg-bg-card2 px-3 py-2 text-sm text-ink placeholder:text-ink-dim/70 focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <button
            type="submit"
            className="rounded-lg border border-line bg-bg-card2 hover:bg-bg-card2/70 px-3 py-2 text-sm text-ink"
          >
            Search
          </button>
          {q && (
            <Link
              href="/squishy/profiles"
              className="rounded-lg border border-line bg-transparent hover:bg-bg-card2/50 px-3 py-2 text-sm text-ink-dim hover:text-ink"
            >
              Clear
            </Link>
          )}
        </form>

        {list === null ? (
          <div className="rounded-xl border border-line bg-bg-card p-6 text-sm text-err">
            Failed to load profiles — the SquishyBot database isn&apos;t
            reachable from the panel right now. Check{' '}
            <code className="font-mono text-xs">SQUISHY_DATABASE_URL</code> and
            container networking, then refresh.
          </div>
        ) : list.length === 0 ? (
          <div className="rounded-xl border border-line bg-bg-card p-6 text-sm text-ink-dim">
            {q ? (
              <>No matches for <span className="font-mono">&apos;{q}&apos;</span>.</>
            ) : (
              <>No profiles yet.</>
            )}
          </div>
        ) : (
          <div className="rounded-xl border border-line bg-bg-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-bg-card2 text-xs uppercase tracking-wider text-ink-dim">
                  <tr>
                    <th className="px-3 py-2 font-medium">User ID</th>
                    <th className="px-3 py-2 font-medium">Display name</th>
                    <th className="px-3 py-2 font-medium">Birthday</th>
                    <th className="px-3 py-2 font-medium">Staff category</th>
                    <th className="px-3 py-2 font-medium">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((p) => (
                    <tr key={p.id} className="border-b border-line last:border-b-0 hover:bg-bg-card2/30">
                      <td className="px-3 py-2 whitespace-nowrap">
                        <Link
                          href={`/squishy/profiles/${p.userId}`}
                          className="font-mono text-xs text-accent hover:underline"
                        >
                          {p.userId}
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-sm">
                        {p.displayName ? (
                          p.displayName
                        ) : (
                          <span className="text-ink-dim">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-sm whitespace-nowrap">
                        {hasBirthday(p) ? (
                          <span className="text-[10px] uppercase tracking-wider text-ok border border-ok/40 rounded px-1.5 py-0.5">
                            yes
                          </span>
                        ) : (
                          <span className="text-[10px] uppercase tracking-wider text-ink-dim border border-line rounded px-1.5 py-0.5">
                            no
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-sm whitespace-nowrap">
                        {p.staffCategory ? (
                          <span className="text-[11px] uppercase tracking-wider text-ink border border-line bg-bg-card2 rounded-full px-2 py-0.5">
                            {p.staffCategory}
                          </span>
                        ) : (
                          <span className="text-ink-dim">—</span>
                        )}
                      </td>
                      <td
                        className="px-3 py-2 text-xs text-ink-dim whitespace-nowrap"
                        title={p.updatedAt.toISOString()}
                      >
                        {relTime(p.updatedAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {list.length === ROW_CAP && (
              <div className="px-3 py-2 text-[11px] text-ink-dim border-t border-line bg-bg-card2/40">
                Showing the {ROW_CAP} most recently-updated profiles. Refine the
                search to find older rows.
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  )
}

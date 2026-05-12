/**
 * /squishy/profiles/[id] — per-user profile detail.
 *
 * Server component. Sudo-gated (Squishy sudo OR bot owner). Reads three
 * tables for the chosen `user_id`:
 *   1. `user_profiles` — the profile row itself (404 card if missing).
 *   2. `user_game_prefs` ⨯ `games` — every game opt-in row joined with the
 *      game name so we don't dump raw `game_id` UUIDs at staff.
 *   3. `staff_approvals` — full request history for this user (`user_id`
 *      column on that table; the spec called it `requesterUserId` but the
 *      vendored schema uses `userId`).
 *
 * Each section's DB call is independently try/catch'd so a transient DB
 * failure degrades to a "data unavailable" card per section instead of a
 * full 500. The Discord-CDN avatar URL needs a hash we don't have (Discord
 * doesn't expose user-avatar hashes via the public API without an OAuth
 * token), so we render a deterministic colored-initial circle hashed from
 * `userId` instead — same approach used by the sidebar fallback.
 *
 * Next 15: `params` is a Promise — must be awaited.
 */
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { eq, desc, asc } from 'drizzle-orm'
import { getSession } from '@/lib/auth/session'
import { resolveAccess } from '@/lib/auth/perms'
import { squishyDb } from '@/lib/db/squishy'
import {
  userProfiles,
  userGamePrefs,
  staffApprovals,
  games,
} from '@/lib/db/schema/squishy'
import { relTime } from '@/lib/util/format'

export const dynamic = 'force-dynamic'

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

type ProfileRow = {
  id: string
  guildId: string
  userId: string
  realName: string | null
  displayName: string | null
  birthdayMonth: number | null
  birthdayDay: number | null
  birthdayYear: number | null
  birthdayPingsEnabled: boolean
  birthdayYearVisible: boolean
  staffCategory: string | null
  department: string | null
  tier: string | null
  leadershipTitle: string | null
  createdAt: Date
  updatedAt: Date
}

type GamePrefRow = {
  gameId: string
  gameName: string
  wantsView: boolean
  wantsPing: boolean
}

type ApprovalRow = {
  id: string
  status: string
  requestedData: unknown
  reviewedBy: string | null
  reviewNote: string | null
  createdAt: Date
  reviewedAt: Date | null
}

async function loadProfile(userId: string): Promise<ProfileRow | null> {
  try {
    const rows = await squishyDb
      .select({
        id: userProfiles.id,
        guildId: userProfiles.guildId,
        userId: userProfiles.userId,
        realName: userProfiles.realName,
        displayName: userProfiles.displayName,
        birthdayMonth: userProfiles.birthdayMonth,
        birthdayDay: userProfiles.birthdayDay,
        birthdayYear: userProfiles.birthdayYear,
        birthdayPingsEnabled: userProfiles.birthdayPingsEnabled,
        birthdayYearVisible: userProfiles.birthdayYearVisible,
        staffCategory: userProfiles.staffCategory,
        department: userProfiles.department,
        tier: userProfiles.tier,
        leadershipTitle: userProfiles.leadershipTitle,
        createdAt: userProfiles.createdAt,
        updatedAt: userProfiles.updatedAt,
      })
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId))
      .orderBy(desc(userProfiles.updatedAt))
      .limit(1)
    return rows[0] ?? null
  } catch (err) {
    console.warn('[squishy/profiles/:id] profile load failed', err)
    return null
  }
}

async function loadGamePrefs(userId: string): Promise<GamePrefRow[] | null> {
  try {
    const rows = await squishyDb
      .select({
        gameId: userGamePrefs.gameId,
        gameName: games.name,
        wantsView: userGamePrefs.wantsView,
        wantsPing: userGamePrefs.wantsPing,
      })
      .from(userGamePrefs)
      .innerJoin(games, eq(games.id, userGamePrefs.gameId))
      .where(eq(userGamePrefs.userId, userId))
      .orderBy(asc(games.name))
    return rows
  } catch (err) {
    console.warn('[squishy/profiles/:id] game prefs load failed', err)
    return null
  }
}

async function loadApprovals(userId: string): Promise<ApprovalRow[] | null> {
  try {
    const rows = await squishyDb
      .select({
        id: staffApprovals.id,
        status: staffApprovals.status,
        requestedData: staffApprovals.requestedData,
        reviewedBy: staffApprovals.reviewedBy,
        reviewNote: staffApprovals.reviewNote,
        createdAt: staffApprovals.createdAt,
        reviewedAt: staffApprovals.reviewedAt,
      })
      .from(staffApprovals)
      .where(eq(staffApprovals.userId, userId))
      .orderBy(desc(staffApprovals.createdAt))
    return rows
  } catch (err) {
    console.warn('[squishy/profiles/:id] approvals load failed', err)
    return null
  }
}

/**
 * Deterministic HSL hue from a Discord snowflake. We slice the last 3 chars
 * (always digits) and mod by 360. Keeps the color stable across renders and
 * avoids pulling a hash dep.
 */
function avatarHue(userId: string): number {
  const tail = userId.slice(-3)
  const n = parseInt(tail, 10)
  if (!Number.isFinite(n)) return 200
  return n % 360
}

function InitialAvatar({ userId, displayName }: { userId: string; displayName: string | null }) {
  const hue = avatarHue(userId)
  const letter = (displayName ?? userId).trim().slice(0, 1).toUpperCase() || '?'
  return (
    <div
      className="w-16 h-16 rounded-full flex items-center justify-center text-2xl font-semibold text-white border border-line shrink-0"
      style={{ background: `hsl(${hue} 50% 40%)` }}
      aria-hidden
    >
      {letter}
    </div>
  )
}

function NotFoundCard({ userId }: { userId: string }) {
  return (
    <main className="min-h-dvh p-6 sm:p-10">
      <div className="max-w-md mx-auto rounded-2xl border border-line bg-bg-card p-6 flex flex-col gap-3">
        <h1 className="text-xl font-semibold">404 — Profile not found</h1>
        <p className="text-ink-dim text-sm">
          No <code className="font-mono text-xs">user_profiles</code> row for{' '}
          <code className="font-mono text-xs">{userId}</code>. The user may
          never have used <code className="font-mono text-xs">/profile</code>,
          or the row was deleted.
        </p>
        <Link href="/squishy/profiles" className="text-sm text-accent underline self-start">
          ← All profiles
        </Link>
      </div>
    </main>
  )
}

function formatBirthday(row: ProfileRow): string | null {
  if (row.birthdayMonth == null || row.birthdayDay == null) return null
  const m = MONTHS[row.birthdayMonth - 1] ?? `${row.birthdayMonth}`
  if (row.birthdayYear != null && row.birthdayYearVisible) {
    return `${m} ${row.birthdayDay}, ${row.birthdayYear}`
  }
  return `${m} ${row.birthdayDay}`
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="text-[10px] uppercase tracking-wider text-ink-dim/80">{label}</div>
      <div className="text-sm text-ink">{children}</div>
    </div>
  )
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === 'approved'
      ? 'text-ok border-ok/40 bg-ok/10'
      : status === 'denied' || status === 'rejected'
        ? 'text-err border-err/40 bg-err/10'
        : status === 'pending'
          ? 'text-accent border-accent/40 bg-accent/10'
          : 'text-ink-dim border-line bg-bg-card2'
  return (
    <span className={`text-[10px] uppercase tracking-wider rounded-full border px-2 py-0.5 ${tone}`}>
      {status}
    </span>
  )
}

export default async function SquishyProfileDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await getSession()
  if (!session) redirect('/api/auth/login')

  const access = await resolveAccess(session)
  const allowed = access.botOwner || access.squishy.sudo
  const { id } = await params
  const isSelf = access.viewing.id === id
  const isSudoEditor = access.botOwner || access.squishy.sudo
  const canEdit = isSelf || isSudoEditor

  if (!allowed) {
    return (
      <main className="min-h-dvh p-6 sm:p-10">
        <div className="max-w-md mx-auto rounded-2xl border border-line bg-bg-card p-6 flex flex-col gap-3">
          <h1 className="text-xl font-semibold">403 — Not allowed</h1>
          <p className="text-ink-dim text-sm">
            Profile details are sudo-only. Ask the bot owner to add your
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

  const profile = await loadProfile(id)
  if (!profile) return <NotFoundCard userId={id} />

  const [prefs, approvals] = await Promise.all([
    loadGamePrefs(id),
    loadApprovals(id),
  ])

  const birthday = formatBirthday(profile)

  // Decide whether the profile-fields card has anything to render — we hide
  // the whole card if every interesting field is null, rather than show an
  // empty grid.
  const hasProfileFields =
    profile.displayName != null ||
    profile.realName != null ||
    birthday != null ||
    profile.staffCategory != null ||
    profile.department != null ||
    profile.tier != null ||
    profile.leadershipTitle != null

  return (
    <main className="min-h-dvh p-6 sm:p-10">
      <div className="max-w-4xl mx-auto flex flex-col gap-6">
        <div className="flex items-center justify-between gap-4">
          <Link href="/squishy/profiles" className="text-sm text-ink-dim hover:text-ink">
            ← All profiles
          </Link>
          <Link href="/me" className="text-sm text-ink-dim hover:text-ink">
            Dashboard
          </Link>
        </div>

        {/* Header card */}
        <section className="rounded-2xl border border-line bg-bg-card p-6 flex items-center gap-4">
          <InitialAvatar userId={profile.userId} displayName={profile.displayName} />
          <div className="flex flex-col gap-1 min-w-0 flex-1">
            <div className="font-mono text-xs text-ink-dim truncate">{profile.userId}</div>
            <h1 className="text-2xl font-semibold truncate">
              {profile.displayName ?? <span className="text-ink-dim italic">(no display name)</span>}
            </h1>
            <div className="text-xs text-ink-dim">Profile</div>
          </div>
          {canEdit && (
            <Link
              href={`/squishy/profiles/${id}/edit`}
              className="shrink-0 rounded-md border border-accent/40 bg-accent/15 px-3 py-1.5 text-sm text-ink hover:bg-accent/25"
            >
              {isSelf && !isSudoEditor ? 'Edit my profile' : 'Edit profile'}
            </Link>
          )}
        </section>

        {/* Profile fields */}
        {hasProfileFields && (
          <section className="rounded-2xl border border-line bg-bg-card p-6 flex flex-col gap-4">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-dim">
              Profile fields
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {profile.displayName != null && (
                <Field label="Display name">{profile.displayName}</Field>
              )}
              {profile.realName != null && (
                <Field label="Real name">{profile.realName}</Field>
              )}
              {birthday != null && (
                <Field label="Birthday">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span>{birthday}</span>
                    {!profile.birthdayPingsEnabled && (
                      <span className="text-[10px] uppercase tracking-wider text-ink-dim border border-line rounded px-1.5 py-0.5">
                        pings off
                      </span>
                    )}
                    {!profile.birthdayYearVisible && profile.birthdayYear != null && (
                      <span className="text-[10px] uppercase tracking-wider text-ink-dim border border-line rounded px-1.5 py-0.5">
                        year hidden
                      </span>
                    )}
                  </div>
                </Field>
              )}
              {profile.staffCategory != null && (
                <Field label="Staff category">
                  <span className="text-[11px] uppercase tracking-wider text-ink border border-line bg-bg-card2 rounded-full px-2 py-0.5">
                    {profile.staffCategory}
                  </span>
                </Field>
              )}
              {profile.department != null && (
                <Field label="Department">{profile.department}</Field>
              )}
              {profile.tier != null && (
                <Field label="Tier">{profile.tier}</Field>
              )}
              {profile.leadershipTitle != null && (
                <Field label="Leadership title">{profile.leadershipTitle}</Field>
              )}
              <Field label="Created">
                <span title={profile.createdAt.toISOString()}>
                  {relTime(profile.createdAt)}
                </span>
              </Field>
              <Field label="Updated">
                <span title={profile.updatedAt.toISOString()}>
                  {relTime(profile.updatedAt)}
                </span>
              </Field>
            </div>
          </section>
        )}

        {/* Game preferences */}
        <section className="rounded-2xl border border-line bg-bg-card overflow-hidden">
          <div className="px-6 py-4 border-b border-line flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-dim">
              Game preferences
            </h2>
            {prefs && (
              <span className="text-xs text-ink-dim">{prefs.length} row{prefs.length === 1 ? '' : 's'}</span>
            )}
          </div>
          {prefs === null ? (
            <div className="p-6 text-sm text-err">
              Failed to load game preferences — DB unavailable.
            </div>
          ) : prefs.length === 0 ? (
            <div className="p-6 text-sm text-ink-dim">No game prefs set.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-bg-card2 text-xs uppercase tracking-wider text-ink-dim">
                  <tr>
                    <th className="px-4 py-2 font-medium">Game</th>
                    <th className="px-4 py-2 font-medium text-center">Wants view</th>
                    <th className="px-4 py-2 font-medium text-center">Wants ping</th>
                  </tr>
                </thead>
                <tbody>
                  {prefs.map((p) => (
                    <tr key={p.gameId} className="border-b border-line last:border-b-0">
                      <td className="px-4 py-2 text-sm">{p.gameName}</td>
                      <td className="px-4 py-2 text-sm text-center">
                        {p.wantsView ? (
                          <span className="text-ok" aria-label="yes">✓</span>
                        ) : (
                          <span className="text-ink-dim/60" aria-label="no">✗</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-sm text-center">
                        {p.wantsPing ? (
                          <span className="text-ok" aria-label="yes">✓</span>
                        ) : (
                          <span className="text-ink-dim/60" aria-label="no">✗</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Staff approval history */}
        <section className="rounded-2xl border border-line bg-bg-card overflow-hidden">
          <div className="px-6 py-4 border-b border-line flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-dim">
              Staff role requests
            </h2>
            {approvals && (
              <span className="text-xs text-ink-dim">{approvals.length} row{approvals.length === 1 ? '' : 's'}</span>
            )}
          </div>
          {approvals === null ? (
            <div className="p-6 text-sm text-err">
              Failed to load staff approvals — DB unavailable.
            </div>
          ) : approvals.length === 0 ? (
            <div className="p-6 text-sm text-ink-dim">No staff role requests.</div>
          ) : (
            <ul className="divide-y divide-line">
              {approvals.map((a) => (
                <li key={a.id} className="px-6 py-3 flex flex-col gap-2">
                  <div className="flex items-center gap-3 flex-wrap">
                    <StatusPill status={a.status} />
                    <span
                      className="text-xs text-ink-dim"
                      title={a.createdAt.toISOString()}
                    >
                      requested {relTime(a.createdAt)}
                    </span>
                    {a.reviewedAt && (
                      <span
                        className="text-xs text-ink-dim"
                        title={a.reviewedAt.toISOString()}
                      >
                        · reviewed {relTime(a.reviewedAt)}
                      </span>
                    )}
                    {a.reviewedBy && (
                      <span className="text-xs text-ink-dim">
                        by <span className="font-mono">{a.reviewedBy}</span>
                      </span>
                    )}
                  </div>
                  {a.reviewNote && (
                    <div className="text-sm text-ink-dim italic">
                      &ldquo;{a.reviewNote}&rdquo;
                    </div>
                  )}
                  <details className="text-xs">
                    <summary className="cursor-pointer text-ink-dim hover:text-ink select-none">
                      Show requested data
                    </summary>
                    <pre className="mt-2 p-3 rounded-lg bg-bg-card2 border border-line overflow-x-auto text-[11px] font-mono">
                      {JSON.stringify(a.requestedData, null, 2)}
                    </pre>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  )
}

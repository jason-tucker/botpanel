/**
 * /squishy/profiles/[id]/edit — user profile editor (sudo or self).
 *
 * Server component. Computes capability gates from the AccessMap and hands
 * the current profile row off to a client form which actually does the PATCH.
 *
 * Gating:
 *   isSelf       = access.viewing.id === id
 *   isSudoEditor = access.botOwner || access.squishy.sudo
 *   allowed      = isSelf || isSudoEditor
 *
 * If neither matches → 403 card (URL stays linkable for a sudo who later
 * lands here from a deep-link).
 *
 * The profile row may not exist yet — the bot lazy-creates it on first
 * `/profile` use. We pass `profile: null` to the client form in that case;
 * the PATCH endpoint upserts on first save.
 *
 * Mode passed to the client form:
 *   'sudo' → full field set (incl. staff.* fields)
 *   'self' → restricted (name + birthday only)
 *
 * Sudo viewers editing their OWN profile get `'sudo'` mode — the staff
 * fields are still appropriate when you're acting on your own row in a
 * sudo capacity.
 *
 * Next 15: `params` is a Promise — must be awaited.
 */
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { and, eq } from 'drizzle-orm'
import { getSession } from '@/lib/auth/session'
import { resolveAccess } from '@/lib/auth/perms'
import { squishyDb, squishySchema } from '@/lib/db/squishy'
import { env } from '@/lib/env'
import { ProfileEditor, type EditableProfile } from './ProfileEditor'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

async function loadProfile(
  guildId: string,
  userId: string,
): Promise<EditableProfile | null> {
  try {
    const rows = await squishyDb
      .select({
        realName: squishySchema.userProfiles.realName,
        displayName: squishySchema.userProfiles.displayName,
        birthdayMonth: squishySchema.userProfiles.birthdayMonth,
        birthdayDay: squishySchema.userProfiles.birthdayDay,
        birthdayYear: squishySchema.userProfiles.birthdayYear,
        birthdayPingsEnabled: squishySchema.userProfiles.birthdayPingsEnabled,
        birthdayYearVisible: squishySchema.userProfiles.birthdayYearVisible,
        staffCategory: squishySchema.userProfiles.staffCategory,
        department: squishySchema.userProfiles.department,
        tier: squishySchema.userProfiles.tier,
        leadershipTitle: squishySchema.userProfiles.leadershipTitle,
      })
      .from(squishySchema.userProfiles)
      .where(
        and(
          eq(squishySchema.userProfiles.guildId, guildId),
          eq(squishySchema.userProfiles.userId, userId),
        ),
      )
      .limit(1)
    return rows[0] ?? null
  } catch (err) {
    console.warn('[squishy/profiles/:id/edit] profile load failed', err)
    return null
  }
}

function ForbiddenCard({ id }: { id: string }) {
  return (
    <main className="min-h-dvh p-6 sm:p-10">
      <div className="max-w-md mx-auto rounded-2xl border border-line bg-bg-card p-6 flex flex-col gap-3">
        <h1 className="text-xl font-semibold">403 — Not allowed</h1>
        <p className="text-ink-dim text-sm">
          You can only edit your own profile, unless you have sudo. Profile
          owners and Squishy sudo (or the bot owner) can edit this row.
        </p>
        <Link href={`/squishy/profiles/${id}`} className="text-sm text-accent underline self-start">
          ← Back to profile
        </Link>
      </div>
    </main>
  )
}

export default async function EditProfilePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await getSession()
  if (!session) redirect('/api/auth/login')

  const access = await resolveAccess(session)
  const { id } = await params

  const isSelf = access.viewing.id === id
  const isSudoEditor = access.botOwner || access.squishy.sudo
  if (!isSelf && !isSudoEditor) {
    return <ForbiddenCard id={id} />
  }

  // The mode controls which field set the client form exposes — sudo gets
  // the full set (incl. staff.* fields), self-service gets the restricted
  // set. A sudo viewer editing their own row still gets sudo mode (their
  // capability hasn't gone away just because the target happens to be them).
  const mode: 'sudo' | 'self' = isSudoEditor ? 'sudo' : 'self'

  // GUILD_ID is required to look up / write the profile row at all (the
  // unique index is on the (guildId, userId) pair). If it isn't configured
  // we can't even load existing data — surface a clear error here so the
  // operator sees it rather than a confusing empty-form-then-500-on-save.
  if (!env.GUILD_ID) {
    return (
      <main className="min-h-dvh p-6 sm:p-10">
        <div className="max-w-md mx-auto rounded-2xl border border-line bg-bg-card p-6 flex flex-col gap-3">
          <h1 className="text-xl font-semibold">Configuration error</h1>
          <p className="text-ink-dim text-sm">
            <code className="font-mono text-xs">GUILD_ID</code> is not set in
            the panel env. Profiles can&apos;t be edited until it&apos;s
            configured.
          </p>
          <Link href={`/squishy/profiles/${id}`} className="text-sm text-accent underline self-start">
            ← Back to profile
          </Link>
        </div>
      </main>
    )
  }

  const profile = await loadProfile(env.GUILD_ID, id)
  const headerName =
    profile?.displayName ?? profile?.realName ?? (isSelf ? session.username : id)

  return (
    <main className="min-h-dvh p-6 sm:p-10">
      <div className="max-w-3xl mx-auto flex flex-col gap-6">
        <div className="flex items-center justify-between gap-4">
          <Link
            href={`/squishy/profiles/${id}`}
            className="text-sm text-ink-dim hover:text-ink"
          >
            ← Back to profile
          </Link>
          <Link href="/me" className="text-sm text-ink-dim hover:text-ink">
            Dashboard
          </Link>
        </div>

        <header className="rounded-2xl border border-line bg-bg-card p-6 flex flex-col gap-1">
          <div className="text-xs uppercase tracking-wider text-ink-dim">
            {mode === 'sudo' ? 'Sudo edit' : 'Self-service edit'}
          </div>
          <h1 className="text-2xl font-semibold truncate">
            Edit profile — {headerName}
          </h1>
          <div className="font-mono text-xs text-ink-dim truncate">{id}</div>
          {mode === 'self' && (
            <p className="text-xs text-ink-dim mt-2">
              Staff fields (category / department / tier / leadership title)
              are sudo-only and aren&apos;t shown here.
            </p>
          )}
        </header>

        <ProfileEditor id={id} mode={mode} profile={profile} />
      </div>
    </main>
  )
}

/**
 * /squishy/members/[id] — per-user drill-down editor.
 *
 * Sudo / bot-owner only. The page composes every per-user setting Squishy
 * tracks into one screen:
 *
 *  - Profile           — reuses `<ProfileEditor mode="sudo">` from
 *                        `/squishy/profiles/[id]/edit`. Same loader, same
 *                        editor, same PATCH route.
 *  - Games             — `<MemberGamePrefsEditor>` mirroring the
 *                        self-service `/me/games` editor but
 *                        parameterized on the URL target.
 *  - Sudo              — toggle `sudo_users` row via `<SudoToggleCard>`.
 *  - Staff Roles       — `<DirectGrantForm>` / `<DirectRevokeForm>` from
 *                        `@/components/staff/DirectStaffControls`, pre-
 *                        filled with the URL target.
 *  - Voice             — `<VoicePresenceCard>` listing every auto_channels
 *                        row the user has a relationship to + inline
 *                        force-disconnect / transfer-to-them buttons.
 *  - Color Role        — `<MemberColorRoleCard>`, only when
 *                        `feature.color_roles` is on in `bot_settings`.
 *  - Pending Staff     — `staff_approvals` rows for this user with
 *                        inline approve / deny.
 *  - Audit             — last 50 setting_changes where the user is either
 *                        the actor or the target.
 *
 * View-As plumbing: we run `resolveAccess` twice — once for the actor's
 * own capabilities (to gate the page), once with `viewAsUserId: id` so
 * sections that lean on the access map see the target's caps. The audit
 * trail always records the REAL actor; the helper handles that.
 *
 * Next 15: `params` is a Promise.
 */
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { and, asc, desc, eq, ilike, or, sql } from 'drizzle-orm'
import { getSession } from '@/lib/auth/session'
import { resolveAccess } from '@/lib/auth/perms'
import { env } from '@/lib/env'
import { squishyDb, squishySchema } from '@/lib/db/squishy'
import { settingChanges } from '@/lib/db/schema/squishy/settingChanges'
import { resolveOneUsername, resolveUsernames } from '@/lib/userDisplay'
import { labelForDepartment, labelForTier } from '@/lib/squishyStaffRoles'
import { AuditTable, type AuditTableRow } from '@/components/AuditTable'
import {
  ApproveButton,
  DenyButton,
  DirectGrantForm,
  DirectRevokeForm,
} from '@/components/staff/DirectStaffControls'
import { UserChip } from '@/components/UserChip'
import { ProfileEditor, type EditableProfile } from '@/app/(dashboard)/squishy/profiles/[id]/edit/ProfileEditor'
import { MemberGamePrefsEditor, type GameRow } from './MemberGamePrefsEditor'
import { SudoToggleCard } from './SudoToggleCard'
import { VoicePresenceCard, type VoiceChannelRow } from './VoicePresenceCard'
import { MemberColorRoleCard, type ColorRoleOption } from './MemberColorRoleCard'
import { relTime } from '@/lib/util/format'

export const dynamic = 'force-dynamic'

const SNOWFLAKE_RE = /^\d{15,25}$/

function NotFoundCard() {
  return (
    <main className="min-h-dvh p-6 sm:p-10">
      <div className="max-w-md mx-auto rounded-2xl border border-line bg-bg-card p-6 flex flex-col gap-3">
        <h1 className="text-xl font-semibold">404 — Not a Discord snowflake</h1>
        <p className="text-ink-dim text-sm">
          The id in the URL doesn&apos;t look like a Discord user id
          (15-25 digits). Pick a member from the
          {' '}
          <Link href="/squishy/members" className="text-accent underline">
            Members browser
          </Link>{' '}
          instead.
        </p>
      </div>
    </main>
  )
}

function ForbiddenCard() {
  return (
    <main className="min-h-dvh p-6 sm:p-10">
      <div className="max-w-md mx-auto rounded-2xl border border-line bg-bg-card p-6 flex flex-col gap-3">
        <h1 className="text-xl font-semibold">403 — Not allowed</h1>
        <p className="text-ink-dim text-sm">
          The Members editor is sudo-only. Ask the bot owner to add you
          to <code className="font-mono text-xs">SUDO_USER_IDS</code> or
          the <code className="font-mono text-xs">sudo_users</code>{' '}
          table.
        </p>
      </div>
    </main>
  )
}

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
    console.warn('[squishy/members/:id] profile load failed', err)
    return null
  }
}

async function loadGameRows(
  guildId: string,
  userId: string,
): Promise<GameRow[]> {
  try {
    const [catalog, prefs] = await Promise.all([
      squishyDb
        .select({
          id: squishySchema.games.id,
          name: squishySchema.games.name,
          aliases: squishySchema.games.aliases,
          sortOrder: squishySchema.games.sortOrder,
          isArchived: squishySchema.games.isArchived,
          isVisible: squishySchema.games.isVisible,
        })
        .from(squishySchema.games)
        .orderBy(
          asc(squishySchema.games.sortOrder),
          asc(squishySchema.games.name),
        ),
      squishyDb
        .select({
          gameId: squishySchema.userGamePrefs.gameId,
          wantsView: squishySchema.userGamePrefs.wantsView,
          wantsPing: squishySchema.userGamePrefs.wantsPing,
        })
        .from(squishySchema.userGamePrefs)
        .where(
          and(
            eq(squishySchema.userGamePrefs.guildId, guildId),
            eq(squishySchema.userGamePrefs.userId, userId),
          ),
        ),
    ])
    const prefMap = new Map<string, { view: boolean; ping: boolean }>()
    for (const p of prefs) prefMap.set(p.gameId, { view: p.wantsView, ping: p.wantsPing })
    return catalog
      .filter((g) => !g.isArchived && g.isVisible)
      .map((g) => ({
        gameId: g.id,
        name: g.name,
        aliases: g.aliases,
        view: prefMap.get(g.id)?.view ?? false,
        ping: prefMap.get(g.id)?.ping ?? false,
      }))
  } catch (err) {
    console.warn('[squishy/members/:id] game prefs load failed', err)
    return []
  }
}

async function loadSudoState(
  userId: string,
): Promise<{ inDb: boolean; inEnv: boolean }> {
  let inEnv = false
  if (env.SUDO_USER_IDS) {
    const ids = env.SUDO_USER_IDS.split(',').map((s) => s.trim()).filter(Boolean)
    inEnv = ids.includes(userId)
  }
  let inDb = false
  try {
    const rows = await squishyDb
      .select({ userId: squishySchema.sudoUsers.userId })
      .from(squishySchema.sudoUsers)
      .where(eq(squishySchema.sudoUsers.userId, userId))
      .limit(1)
    inDb = rows.length > 0
  } catch (err) {
    console.warn('[squishy/members/:id] sudo lookup failed', err)
  }
  return { inDb, inEnv }
}

async function loadVoicePresence(userId: string): Promise<VoiceChannelRow[]> {
  // We load two slices: rows where the user is owner/acting/host (via the
  // autoChannels columns) and rows where they're a current member (via the
  // join-tracking table). UNION-by-id in JS so a member who's also the
  // owner shows up once.
  try {
    const [byOwnership, byMembership] = await Promise.all([
      squishyDb.execute(sql`
        select voice_channel_id, text_channel_id, manual_name, fallback_name,
               owner_user_id, host_user_ids, acting_owner_user_id
        from auto_channels
        where owner_user_id = ${userId}
           or acting_owner_user_id = ${userId}
           or ${userId} = ANY(host_user_ids)
      `),
      squishyDb.execute(sql`
        select ac.voice_channel_id, ac.text_channel_id, ac.manual_name, ac.fallback_name,
               ac.owner_user_id, ac.host_user_ids, ac.acting_owner_user_id
        from auto_channels ac
        join auto_channel_members m on m.voice_channel_id = ac.voice_channel_id
        where m.user_id = ${userId}
      `),
    ])
    type Raw = {
      voice_channel_id: string
      text_channel_id: string
      manual_name: string | null
      fallback_name: string | null
      owner_user_id: string
      host_user_ids: string[] | null
      acting_owner_user_id: string | null
    }
    const ownershipRows = ((byOwnership as unknown as { rows?: Raw[] }).rows
      ?? (byOwnership as unknown as Raw[])) as Raw[]
    const membershipRows = ((byMembership as unknown as { rows?: Raw[] }).rows
      ?? (byMembership as unknown as Raw[])) as Raw[]
    const byId = new Map<string, VoiceChannelRow>()
    for (const r of ownershipRows) {
      byId.set(r.voice_channel_id, {
        voiceChannelId: r.voice_channel_id,
        textChannelId: r.text_channel_id,
        channelName: r.manual_name ?? r.fallback_name ?? r.voice_channel_id,
        ownerUserId: r.owner_user_id,
        isOwner: r.owner_user_id === userId,
        isActingOwner: r.acting_owner_user_id === userId,
        isHost: Array.isArray(r.host_user_ids) && r.host_user_ids.includes(userId),
        isMember: false,
      })
    }
    for (const r of membershipRows) {
      const existing = byId.get(r.voice_channel_id)
      if (existing) {
        existing.isMember = true
      } else {
        byId.set(r.voice_channel_id, {
          voiceChannelId: r.voice_channel_id,
          textChannelId: r.text_channel_id,
          channelName: r.manual_name ?? r.fallback_name ?? r.voice_channel_id,
          ownerUserId: r.owner_user_id,
          isOwner: false,
          isActingOwner: false,
          isHost: false,
          isMember: true,
        })
      }
    }
    return Array.from(byId.values()).sort((a, b) => a.channelName.localeCompare(b.channelName))
  } catch (err) {
    console.warn('[squishy/members/:id] voice presence load failed', err)
    return []
  }
}

async function loadColorState(
  guildId: string,
  userId: string,
): Promise<{ enabled: boolean; options: ColorRoleOption[]; currentRoleId: string | null }> {
  try {
    const flagRow = await squishyDb
      .select({ value: squishySchema.botSettings.value })
      .from(squishySchema.botSettings)
      .where(eq(squishySchema.botSettings.key, 'feature.color_roles'))
      .limit(1)
    const flagVal = flagRow[0]?.value
    const enabled = flagVal === 'true' || flagVal === '1' || flagVal === 'on'
    if (!enabled) return { enabled: false, options: [], currentRoleId: null }

    // Curated set + the user's current curated color (if any). The "current"
    // lookup is best-effort: we don't have a way to ask the bot which role
    // the user holds without an extra RPC, so we leave it null for now —
    // the editor still works as a set/clear UI. (Future: a `color.get`
    // verb could return the current pick; not blocking this PR.)
    const options = await squishyDb
      .select({
        roleId: squishySchema.colorRoles.roleId,
        label: squishySchema.colorRoles.label,
        sortOrder: squishySchema.colorRoles.sortOrder,
      })
      .from(squishySchema.colorRoles)
      .where(eq(squishySchema.colorRoles.guildId, guildId))
      .orderBy(asc(squishySchema.colorRoles.sortOrder), asc(squishySchema.colorRoles.label))
    return {
      enabled: true,
      options: options.map((o) => ({ roleId: o.roleId, label: o.label })),
      currentRoleId: null,
    }
  } catch (err) {
    console.warn('[squishy/members/:id] color role load failed', err)
    return { enabled: false, options: [], currentRoleId: null }
  }
}

type PendingApproval = {
  id: string
  departmentLabel: string | null
  tierLabel: string | null
  realName: string | null
  createdAt: Date
}

async function loadPendingApprovals(
  guildId: string,
  userId: string,
): Promise<PendingApproval[]> {
  try {
    const rows = await squishyDb
      .select({
        id: squishySchema.staffApprovals.id,
        requestedData: squishySchema.staffApprovals.requestedData,
        createdAt: squishySchema.staffApprovals.createdAt,
      })
      .from(squishySchema.staffApprovals)
      .where(
        and(
          eq(squishySchema.staffApprovals.guildId, guildId),
          eq(squishySchema.staffApprovals.userId, userId),
          eq(squishySchema.staffApprovals.status, 'pending'),
        ),
      )
      .orderBy(desc(squishySchema.staffApprovals.createdAt))
    return rows.map((r) => {
      const d = (r.requestedData ?? {}) as {
        department_key?: string | null
        department_label?: string | null
        tier_key?: string | null
        tier_label?: string | null
        role_key?: string
        role_label?: string
        real_name?: string | null
      }
      let departmentLabel: string | null = null
      let tierLabel: string | null = null
      if (d.department_key) {
        const slug = d.department_key.replace(/^staff\.role\./, '')
        departmentLabel = d.department_label ?? labelForDepartment(slug) ?? slug
      }
      if (d.tier_key) {
        const slug = d.tier_key.replace(/^staff\.role\./, '')
        tierLabel = d.tier_label ?? labelForTier(slug) ?? slug
      }
      if (!departmentLabel && !tierLabel && d.role_key) {
        const slug = d.role_key.replace(/^staff\.role\./, '')
        const tierGuess = labelForTier(slug)
        if (tierGuess) tierLabel = d.role_label ?? tierGuess
        else departmentLabel = d.role_label ?? labelForDepartment(slug) ?? slug
      }
      return {
        id: r.id,
        departmentLabel,
        tierLabel,
        realName: d.real_name ?? null,
        createdAt: r.createdAt,
      }
    })
  } catch (err) {
    console.warn('[squishy/members/:id] pending approvals load failed', err)
    return []
  }
}

async function loadAuditRows(userId: string): Promise<AuditTableRow[]> {
  // `setting_changes.changed_by_user_id` is either `<actor>` or
  // `<actor>:via:<viewing>`. We match the userId on either half via
  // prefix/suffix LIKEs — covers actor-only rows AND `via` rows where
  // the user appears as either actor or impersonated.
  try {
    const rows = await squishyDb
      .select({
        id: settingChanges.id,
        key: settingChanges.key,
        oldValue: settingChanges.oldValue,
        newValue: settingChanges.newValue,
        changedByUserId: settingChanges.changedByUserId,
        changedAt: settingChanges.changedAt,
      })
      .from(settingChanges)
      .where(
        or(
          // Pure-actor or actor-with-via prefix.
          ilike(settingChanges.changedByUserId, `${userId}%`),
          // `viewing` half of an `actor:via:viewing` encoding.
          ilike(settingChanges.changedByUserId, `%:via:${userId}`),
          // Setting key contains the user id (e.g. per-user keys).
          ilike(settingChanges.key, `%${userId}%`),
        ),
      )
      .orderBy(desc(settingChanges.changedAt))
      .limit(50)

    return rows.map((r) => {
      const raw = r.changedByUserId ?? 'unknown'
      const sep = raw.indexOf(':via:')
      const actor = sep < 0 ? raw : raw.slice(0, sep)
      const viewing = sep < 0 ? null : raw.slice(sep + ':via:'.length)
      const action =
        r.newValue === null
          ? 'setting.cleared'
          : r.oldValue === null
            ? 'setting.set'
            : 'setting.changed'
      const parse = (v: string | null) => {
        if (v === null) return null
        try {
          return JSON.parse(v)
        } catch {
          return v
        }
      }
      return {
        id: r.id,
        changedAt: r.changedAt,
        action,
        actorUserId: actor,
        viewingUserId: viewing,
        source: 'web' as const,
        success: true,
        errorMessage: null,
        before: { key: r.key, value: parse(r.oldValue) },
        after: { key: r.key, value: parse(r.newValue) },
      }
    })
  } catch (err) {
    console.warn('[squishy/members/:id] audit load failed', err)
    return []
  }
}

function Section({
  heading,
  children,
  hint,
}: {
  heading: string
  children: React.ReactNode
  hint?: string
}) {
  return (
    <details
      className="group rounded-2xl border border-line bg-bg-card overflow-hidden"
      open
    >
      <summary className="cursor-pointer list-none flex items-baseline justify-between gap-3 px-4 py-3 border-b border-line group-open:bg-bg-card2/40">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-dim">
          {heading}
        </h2>
        {hint && <span className="text-[11px] text-ink-dim/70">{hint}</span>}
      </summary>
      <div className="p-4">{children}</div>
    </details>
  )
}

export default async function MemberDrillPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await getSession()
  if (!session) redirect('/api/auth/login')

  const { id } = await params
  if (!SNOWFLAKE_RE.test(id)) {
    return <NotFoundCard />
  }

  // First gate: the real signed-in user must be sudo / bot-owner. Then
  // a SECOND resolveAccess with `viewAsUserId: id` so any downstream
  // capability check sees the target's caps. The audit trail still
  // records the real actor — writeAudit reads `access.actor` (always
  // the signed-in user) for that.
  const actorAccess = await resolveAccess(session)
  const canView = actorAccess.botOwner || actorAccess.squishy.sudo
  if (!canView) return <ForbiddenCard />

  const access = await resolveAccess(session, { viewAsUserId: id })

  if (!env.GUILD_ID) {
    return (
      <main className="min-h-dvh p-6 sm:p-10">
        <div className="max-w-md mx-auto rounded-2xl border border-line bg-bg-card p-6 flex flex-col gap-3">
          <h1 className="text-xl font-semibold">Configuration error</h1>
          <p className="text-ink-dim text-sm">
            <code className="font-mono text-xs">GUILD_ID</code> is not set
            in the panel env. The Members editor needs a configured guild
            to look up profiles / games / voice presence.
          </p>
        </div>
      </main>
    )
  }
  const guildId = env.GUILD_ID

  // Parallel load — every section reads from its own table; we let one
  // failure degrade just that section rather than 500ing the page.
  const [
    profile,
    gameRows,
    sudoState,
    voicePresence,
    colorState,
    pendingApprovals,
    auditRows,
    targetUser,
  ] = await Promise.all([
    loadProfile(guildId, id),
    loadGameRows(guildId, id),
    loadSudoState(id),
    loadVoicePresence(id),
    loadColorState(guildId, id),
    loadPendingApprovals(guildId, id),
    loadAuditRows(id),
    resolveOneUsername('squishy', id),
  ])

  // Audit page needs resolved usernames for every actor it shows.
  const auditUserIds: string[] = []
  for (const r of auditRows) {
    auditUserIds.push(r.actorUserId)
    if (r.viewingUserId) auditUserIds.push(r.viewingUserId)
  }
  const auditUserMap = await resolveUsernames('squishy', auditUserIds)

  const headerName =
    targetUser?.displayName
    ?? targetUser?.username
    ?? profile?.displayName
    ?? profile?.realName
    ?? id

  const isCurrentlySudo = sudoState.inDb || sudoState.inEnv

  // suppress unused-var warning while keeping `access` available for
  // future per-section gating that reads from the targeted access map.
  void access

  return (
    <main className="min-h-dvh p-6 sm:p-10 pt-16 md:pt-10">
      <div className="max-w-4xl mx-auto flex flex-col gap-6">
        <div className="flex items-center justify-between gap-4">
          <Link
            href="/squishy/members"
            className="text-sm text-ink-dim hover:text-ink"
          >
            ← Back to Members
          </Link>
        </div>

        <header className="rounded-2xl border border-line bg-bg-card p-6 flex flex-col gap-3">
          <div className="text-xs uppercase tracking-wider text-ink-dim">
            Member · sudo edit
          </div>
          <div className="flex items-center gap-3">
            <UserChip userId={id} resolved={targetUser} />
            <span className="font-mono text-xs text-ink-dim">{id}</span>
          </div>
          <h1 className="text-2xl font-semibold truncate">
            {headerName}
          </h1>
          <p className="text-xs text-ink-dim">
            Every per-user setting Squishy tracks, in one place. All
            changes are audited as the real signed-in user with the
            target carried in the viewing identity.
          </p>
        </header>

        <Section heading="Profile" hint="from /profile (sudo mode)">
          <ProfileEditor id={id} mode="sudo" profile={profile} />
        </Section>

        <Section heading="Games" hint="mirrors /games slash flow">
          <MemberGamePrefsEditor userId={id} rows={gameRows} />
        </Section>

        <Section heading="Sudo" hint="toggles sudo_users row">
          <SudoToggleCard
            userId={id}
            isCurrentlySudo={isCurrentlySudo}
            sourceIsEnv={sudoState.inEnv && !sudoState.inDb}
          />
        </Section>

        <Section heading="Staff Roles" hint="mirrors /sudo → Staff Roles">
          <div className="flex flex-col gap-3">
            <DirectGrantForm defaultUserId={id} />
            <DirectRevokeForm defaultUserId={id} />
          </div>
        </Section>

        <Section heading="Voice" hint="mirrors /voice slash panel">
          <VoicePresenceCard userId={id} channels={voicePresence} />
        </Section>

        {colorState.enabled && (
          <Section heading="Color Role" hint="mirrors /color slash">
            <MemberColorRoleCard
              userId={id}
              options={colorState.options}
              currentRoleId={colorState.currentRoleId}
            />
          </Section>
        )}

        <Section heading="Pending Staff Requests" hint="awaiting review">
          {pendingApprovals.length === 0 ? (
            <div className="text-sm text-ink-dim italic">
              No pending requests from this user.
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {pendingApprovals.map((a) => {
                const summary =
                  a.departmentLabel && a.tierLabel
                    ? `${a.departmentLabel} · ${a.tierLabel}`
                    : (a.departmentLabel ?? a.tierLabel ?? 'staff')
                return (
                  <div
                    key={a.id}
                    className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-bg-card2/40 p-3"
                  >
                    <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                      <span className="text-sm text-ink">{summary}</span>
                      {a.realName && (
                        <span className="text-[11px] text-ink-dim">
                          real name: {a.realName}
                        </span>
                      )}
                      <span
                        className="text-[10px] text-ink-dim"
                        title={a.createdAt.toISOString()}
                      >
                        filed {relTime(a.createdAt)}
                      </span>
                    </div>
                    <span className="inline-flex items-center gap-1">
                      <ApproveButton id={a.id} />
                      <DenyButton id={a.id} />
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </Section>

        <Section heading="Audit" hint="last 50 actions involving this user">
          <AuditTable
            rows={auditRows}
            page={1}
            pageSize={50}
            total={auditRows.length}
            pathname={`/squishy/members/${id}`}
            searchParams={{}}
            bot="squishy"
            filters={{ success: 'all' }}
            resolved={auditUserMap}
          />
        </Section>
      </div>
    </main>
  )
}

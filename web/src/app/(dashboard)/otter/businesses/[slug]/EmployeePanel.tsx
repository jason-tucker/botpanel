'use client'
/**
 * EmployeePanel — Wave 7e per-business member roster + role editor.
 *
 * Rewrites the Wave 7c-B panel: the "Current owners" list previously
 * came from `business_owners` only and there was no way to enumerate
 * managers / employees (they live as pure Discord roles). The panel
 * now hits `GET /api/otter/businesses/[slug]/roster` on mount, which
 * forwards to the bot's `business.roster` RPC verb and returns every
 * member holding any mapped role for this business, grouped by rank.
 *
 * Sections:
 *  - **Hire** — unchanged Wave 7c-B form. Owner option only when the
 *    viewer is a business owner / bot owner.
 *  - **Members** — owner / manager / employee groups with per-row
 *    Promote / Demote / Fire buttons. Owners can promote a manager
 *    up to owner; managers can't.
 *  - **Manage by ID (advanced)** — the original free-form
 *    promote/demote/fire input, collapsed by default. Kept as a
 *    fallback for users who aren't on the role-derived roster yet
 *    (e.g. a fresh hire with no roles yet, or a ban-grant target).
 *
 * Action onSuccess: `router.refresh()` + bump the local cache-bust
 * counter so the next roster fetch passes `?t=...` and bypasses the
 * route's 30s module cache. Simpler than coordinating an out-of-band
 * cache-invalidation message between the panel and the route module.
 *
 * Roster fetch failure: render a friendly "couldn't load roster"
 * card with a Retry button. The DB-owner roster comes from the
 * server render path (see `page.tsx`), so the operator still has the
 * Manage-by-ID fallback even if the bot is unreachable.
 *
 * Last-owner guard: an owner row never renders Fire (or Demote when
 * the actor is the only owner) when there's exactly one owner in the
 * roster — the panel must never offer a way to delete the final
 * owner. Server-side guards (cannot-fire-owner) still cover the
 * race where the count changes between render and submit.
 */
import Image from 'next/image'
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ServerForm } from '@/lib/forms/ServerForm'
import { MemberPicker } from '@/components/pickers/MemberPicker'

type Rank = 'owner' | 'manager' | 'employee'

export type RosterMember = {
  userId: string
  username: string
  displayName: string
  avatarUrl: string | null
  rank: Rank
}

type RosterReply = {
  members: RosterMember[]
  counts: { owner: number; manager: number; employee: number }
}

export type EmployeePanelProps = {
  slug: string
  /** True when the viewer can hire someone as `owner` (business owner / bot owner). */
  canActAsOwner: boolean
}

function pillClass(extra: string): string {
  return `inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${extra}`
}

function rankPillClass(rank: Rank): string {
  if (rank === 'owner') return 'bg-rank-owner/15 text-rank-owner border-rank-owner/30'
  if (rank === 'manager') return 'bg-rank-manager/15 text-rank-manager border-rank-manager/30'
  return 'bg-rank-employee/15 text-rank-employee border-rank-employee/30'
}

// ── Inline member chip ─────────────────────────────────────────────
// UserChip is a server component, so we can't import it directly into
// a client tree. The chip is just `<img> @displayName` though, so we
// inline the same rendering here. Falls back to a raw-id pill when
// the bot didn't return a displayName (e.g. user left the guild but
// is still in `business_owners`).

function MemberChip({ member }: { member: RosterMember }): React.JSX.Element {
  const showRich =
    member.displayName && member.displayName !== member.userId && member.avatarUrl
  if (!showRich) {
    return (
      <span
        className="inline-flex items-center font-mono text-xs text-ink whitespace-nowrap"
        title={member.userId}
      >
        {member.userId}
      </span>
    )
  }
  return (
    <span
      className="inline-flex items-center gap-1.5 align-middle whitespace-nowrap"
      title={`${member.userId} · @${member.username}`}
    >
      {/* next/image — Discord CDN allowlisted in next.config.mjs. The outer
          `showRich` guard already ensures member.avatarUrl is non-null. */}
      <Image
        src={member.avatarUrl as string}
        alt=""
        width={24}
        height={24}
        className="h-6 w-6 rounded-full border border-line"
        referrerPolicy="no-referrer"
      />
      <span className="text-sm text-ink">@{member.displayName}</span>
    </span>
  )
}

// ── Hire form ─────────────────────────────────────────────────────

function HireForm({
  slug,
  canActAsOwner,
  onSuccess,
}: {
  slug: string
  canActAsOwner: boolean
  onSuccess: () => void
}): React.JSX.Element {
  return (
    <ServerForm
      action={`/api/otter/businesses/${slug}/employees/hire`}
      method="POST"
      onSuccess={onSuccess}
      resetOnSuccess
      className="flex flex-wrap items-end gap-3"
    >
      <label className="flex flex-col gap-1 min-w-[14rem]">
        <span className="text-xs uppercase tracking-wider text-ink-dim">
          Member
        </span>
        <MemberPicker name="userId" bot="otter" placeholder="Search members…" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-wider text-ink-dim">Rank</span>
        <select
          name="rank"
          defaultValue="employee"
          className="rounded-md border border-line bg-bg-card2 px-3 py-1.5 text-sm"
        >
          <option value="employee">employee</option>
          <option value="manager">manager</option>
          {canActAsOwner && <option value="owner">owner</option>}
        </select>
      </label>
      <button
        type="submit"
        className="rounded-md border border-accent/30 bg-accent/15 px-3 py-1.5 text-sm text-accent hover:bg-accent/25"
      >
        Hire
      </button>
    </ServerForm>
  )
}

// ── Single-action button form (Promote / Demote / Fire) ────────────

function ActionButton({
  slug,
  verb,
  userId,
  label,
  confirm,
  variant,
  reason,
  onSuccess,
}: {
  slug: string
  verb: 'promote' | 'demote' | 'fire'
  userId: string
  label: string
  confirm?: string
  variant: 'neutral' | 'warn' | 'danger'
  reason?: string
  onSuccess: () => void
}): React.JSX.Element {
  const cls =
    variant === 'danger'
      ? 'border-err/40 bg-err/15 text-err hover:bg-err/25'
      : variant === 'warn'
        ? 'border-yellow-500/40 bg-yellow-500/10 text-yellow-200 hover:bg-yellow-500/20'
        : 'border-line bg-bg-card2 text-ink hover:bg-bg-card2/70'
  return (
    <ServerForm
      action={`/api/otter/businesses/${slug}/employees/${verb}`}
      method="POST"
      confirm={confirm}
      onSuccess={onSuccess}
      className="inline-flex"
    >
      <input type="hidden" name="userId" value={userId} />
      {reason !== undefined && <input type="hidden" name="reason" value={reason} />}
      <button
        type="submit"
        className={`rounded-md border px-2.5 py-1 text-xs font-medium ${cls}`}
      >
        {label}
      </button>
    </ServerForm>
  )
}

// ── Per-row member entry ──────────────────────────────────────────

function MemberRow({
  slug,
  member,
  isActorOwner,
  ownerCount,
  onSuccess,
}: {
  slug: string
  member: RosterMember
  /** True if the viewer is a business owner or bot owner. */
  isActorOwner: boolean
  /** Total owners in the roster — used for the last-owner guard. */
  ownerCount: number
  onSuccess: () => void
}): React.JSX.Element {
  return (
    <li className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-bg-card2 px-3 py-2">
      <MemberChip member={member} />
      <span className={pillClass(rankPillClass(member.rank))}>{member.rank}</span>
      <code
        className="font-mono text-xs text-ink-dim truncate"
        title={member.userId}
      >
        {member.userId}
      </code>
      <div className="ml-auto flex flex-wrap gap-1.5">
        {member.rank === 'employee' && (
          <>
            <ActionButton
              slug={slug}
              verb="promote"
              userId={member.userId}
              label="Promote to manager"
              variant="neutral"
              onSuccess={onSuccess}
            />
            <ActionButton
              slug={slug}
              verb="fire"
              userId={member.userId}
              label="Fire"
              variant="danger"
              confirm={`Fire @${member.displayName} from this business? Strips all business roles.`}
              onSuccess={onSuccess}
            />
          </>
        )}
        {member.rank === 'manager' && (
          <>
            {isActorOwner && (
              <ActionButton
                slug={slug}
                verb="promote"
                userId={member.userId}
                label="Promote to owner"
                variant="neutral"
                confirm={`Promote @${member.displayName} to owner? They will be added to business_owners.`}
                onSuccess={onSuccess}
              />
            )}
            <ActionButton
              slug={slug}
              verb="demote"
              userId={member.userId}
              label="Demote to employee"
              variant="warn"
              confirm={`Demote @${member.displayName} from manager to employee?`}
              onSuccess={onSuccess}
            />
            <ActionButton
              slug={slug}
              verb="fire"
              userId={member.userId}
              label="Fire"
              variant="danger"
              confirm={`Fire @${member.displayName} from this business? Strips all business roles.`}
              onSuccess={onSuccess}
            />
          </>
        )}
        {member.rank === 'owner' && (
          <>
            {/* Last-owner guard: only render demote / fire when we're not
                looking at the only remaining owner. Server-side
                cannot-fire-owner also catches this on the API. */}
            {isActorOwner && ownerCount > 1 && (
              <>
                <ActionButton
                  slug={slug}
                  verb="demote"
                  userId={member.userId}
                  label="Demote to manager"
                  variant="warn"
                  confirm={`Demote @${member.displayName} from owner to manager? Clears business_owners row.`}
                  onSuccess={onSuccess}
                />
                <ActionButton
                  slug={slug}
                  verb="fire"
                  userId={member.userId}
                  label="Fire"
                  variant="danger"
                  confirm={`Fire @${member.displayName} from this business? They must be demoted first server-side; this will return cannot-fire-owner unless their owner record is already cleared.`}
                  onSuccess={onSuccess}
                />
              </>
            )}
            {(!isActorOwner || ownerCount <= 1) && (
              <span className="text-xs text-ink-dim italic">
                {ownerCount <= 1
                  ? 'Last owner — cannot demote / fire from panel.'
                  : 'Only owners can demote / fire owners.'}
              </span>
            )}
          </>
        )}
      </div>
    </li>
  )
}

// ── Members section ──────────────────────────────────────────────

function MembersSkeleton(): React.JSX.Element {
  return (
    <ul className="flex flex-col gap-2" aria-label="Loading members">
      {Array.from({ length: 3 }).map((_, i) => (
        <li
          key={i}
          className="flex items-center gap-3 rounded-lg border border-line bg-bg-card2 px-3 py-2 animate-pulse"
        >
          <div className="h-6 w-6 rounded-full bg-bg-card" />
          <div className="h-4 w-32 rounded bg-bg-card" />
          <div className="h-4 w-16 rounded bg-bg-card" />
          <div className="ml-auto h-6 w-24 rounded bg-bg-card" />
        </li>
      ))}
    </ul>
  )
}

function GroupHeader({
  label,
  count,
}: {
  label: string
  count: number
}): React.JSX.Element {
  return (
    <div className="flex items-baseline gap-2">
      <h3 className="text-sm font-medium">{label}</h3>
      <span className="text-xs text-ink-dim">({count})</span>
    </div>
  )
}

function MembersSection({
  slug,
  members,
  loading,
  loadError,
  isActorOwner,
  onSuccess,
  onRetry,
}: {
  slug: string
  members: RosterMember[]
  loading: boolean
  loadError: string | null
  isActorOwner: boolean
  onSuccess: () => void
  onRetry: () => void
}): React.JSX.Element {
  if (loading) return <MembersSkeleton />
  if (loadError) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-yellow-500/40 bg-yellow-500/10 px-3 py-3">
        <p className="text-sm text-yellow-200">
          Couldn&apos;t load the live roster ({loadError}). The bot may be
          unreachable. Use Manage by ID (advanced) below as a fallback.
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="self-start rounded-md border border-line bg-bg-card2 px-3 py-1 text-xs hover:bg-bg-card"
        >
          Retry
        </button>
      </div>
    )
  }

  const owners = members.filter((m) => m.rank === 'owner')
  const managers = members.filter((m) => m.rank === 'manager')
  const employees = members.filter((m) => m.rank === 'employee')

  if (members.length === 0) {
    return (
      <p className="text-xs text-ink-dim italic">
        No members hold any of this business&apos;s mapped roles. Hire someone
        above to populate the roster.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {owners.length > 0 && (
        <div className="flex flex-col gap-2">
          <GroupHeader label="Owners" count={owners.length} />
          <ul className="flex flex-col gap-2">
            {owners.map((m) => (
              <MemberRow
                key={m.userId}
                slug={slug}
                member={m}
                isActorOwner={isActorOwner}
                ownerCount={owners.length}
                onSuccess={onSuccess}
              />
            ))}
          </ul>
        </div>
      )}
      {managers.length > 0 && (
        <div className="flex flex-col gap-2">
          <GroupHeader label="Managers" count={managers.length} />
          <ul className="flex flex-col gap-2">
            {managers.map((m) => (
              <MemberRow
                key={m.userId}
                slug={slug}
                member={m}
                isActorOwner={isActorOwner}
                ownerCount={owners.length}
                onSuccess={onSuccess}
              />
            ))}
          </ul>
        </div>
      )}
      {employees.length > 0 && (
        <div className="flex flex-col gap-2">
          <GroupHeader label="Employees" count={employees.length} />
          <ul className="flex flex-col gap-2">
            {employees.map((m) => (
              <MemberRow
                key={m.userId}
                slug={slug}
                member={m}
                isActorOwner={isActorOwner}
                ownerCount={owners.length}
                onSuccess={onSuccess}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

// ── Free-form Manage-by-ID (advanced) block ──────────────────────

function ManageByIdBlock({
  slug,
  onSuccess,
}: {
  slug: string
  onSuccess: () => void
}): React.JSX.Element {
  const [verb, setVerb] = useState<'promote' | 'demote' | 'fire'>('promote')
  return (
    <ServerForm
      action={`/api/otter/businesses/${slug}/employees/${verb}`}
      method="POST"
      onResolveAction={() => `/api/otter/businesses/${slug}/employees/${verb}`}
      onSuccess={onSuccess}
      resetOnSuccess
      className="flex flex-wrap items-end gap-3"
    >
      <label className="flex flex-col gap-1 min-w-[14rem]">
        <span className="text-xs uppercase tracking-wider text-ink-dim">
          User ID
        </span>
        {/* Plain snowflake input — the whole point of this block is to act
            on users who aren't in the live roster (just-left, ban-grant
            targets), so a MemberPicker over the bot's member cache would
            silently filter them out. `pattern` matches the API-side Zod
            schema in employees/_lib.ts so the browser catches obvious typos
            before the round-trip. */}
        <input
          type="text"
          name="userId"
          required
          inputMode="numeric"
          pattern="\d{15,25}"
          placeholder="e.g. 987654321098765432"
          className="rounded-md border border-line bg-bg-card2 px-3 py-1.5 text-sm font-mono"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-wider text-ink-dim">Action</span>
        <select
          value={verb}
          onChange={(e) => setVerb(e.target.value as typeof verb)}
          className="rounded-md border border-line bg-bg-card2 px-3 py-1.5 text-sm"
        >
          <option value="promote">Promote (one rung)</option>
          <option value="demote">Demote (one rung)</option>
          <option value="fire">Fire</option>
        </select>
      </label>
      {verb === 'fire' && (
        <label className="flex flex-col gap-1 min-w-[18rem] flex-1">
          <span className="text-xs uppercase tracking-wider text-ink-dim">
            Reason (audit)
          </span>
          <input
            name="reason"
            maxLength={500}
            placeholder="Optional — shown in the audit row."
            className="rounded-md border border-line bg-bg-card2 px-3 py-1.5 text-sm"
          />
        </label>
      )}
      <button
        type="submit"
        className={`rounded-md border px-3 py-1.5 text-sm ${
          verb === 'fire'
            ? 'border-err/40 bg-err/15 text-err hover:bg-err/25'
            : verb === 'demote'
              ? 'border-yellow-500/40 bg-yellow-500/10 text-yellow-200 hover:bg-yellow-500/20'
              : 'border-accent/30 bg-accent/15 text-accent hover:bg-accent/25'
        }`}
      >
        {verb === 'promote' ? 'Promote' : verb === 'demote' ? 'Demote' : 'Fire'}
      </button>
    </ServerForm>
  )
}

// ── Public ────────────────────────────────────────────────────────

export function EmployeePanel({
  slug,
  canActAsOwner,
}: EmployeePanelProps): React.JSX.Element {
  const router = useRouter()
  const [members, setMembers] = useState<RosterMember[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  // Bumped on every successful write so the next roster fetch passes
  // `?t=...` to bypass the route's 30s cache. Also forces this effect
  // to re-run.
  const [cacheBust, setCacheBust] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError(null)

    // First mount is unkeyed; subsequent fetches pass `t` so the route
    // bypasses its module cache.
    const url =
      cacheBust === 0
        ? `/api/otter/businesses/${slug}/roster`
        : `/api/otter/businesses/${slug}/roster?t=${cacheBust}`

    fetch(url, { credentials: 'same-origin' })
      .then(async (res) => {
        if (cancelled) return
        if (!res.ok) {
          let token = `${res.status}`
          try {
            const body = (await res.json()) as { error?: string }
            if (body?.error) token = body.error
          } catch {
            // Body wasn't JSON — surface the status code.
          }
          setLoadError(token)
          setMembers([])
          return
        }
        const body = (await res.json()) as RosterReply
        if (cancelled) return
        setMembers(Array.isArray(body.members) ? body.members : [])
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setLoadError(err instanceof Error ? err.message : 'fetch-failed')
        setMembers([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [slug, cacheBust])

  const onSuccess = useCallback(() => {
    setCacheBust(Date.now())
    router.refresh()
  }, [router])

  const onRetry = useCallback(() => {
    setCacheBust(Date.now())
  }, [])

  return (
    <section className="rounded-2xl border border-line bg-bg-card p-5 flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-xs uppercase tracking-wider text-ink-dim">
          Employee management
        </h2>
        <p className="text-xs text-ink-dim">
          Hire, fire, promote, or demote staff. Every action mirrors the bot&apos;s{' '}
          <code className="font-mono text-xs">/employee</code> slash command —
          Discord roles are mutated server-side and a matching audit row is
          written here.
        </p>
      </div>

      {/* Hire */}
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">Hire</h3>
        <HireForm slug={slug} canActAsOwner={canActAsOwner} onSuccess={onSuccess} />
        {!canActAsOwner && (
          <p className="text-xs text-ink-dim italic">
            Only business owners (or bot owner) can hire someone as{' '}
            <code className="font-mono">owner</code>.
          </p>
        )}
      </div>

      {/* Members — live roster */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-medium">Members</h3>
          <p className="text-xs text-ink-dim">
            Live roster from the bot — every member with one of this
            business&apos;s mapped Discord roles, plus DB-recorded owners.
          </p>
        </div>
        <MembersSection
          slug={slug}
          members={members}
          loading={loading}
          loadError={loadError}
          isActorOwner={canActAsOwner}
          onSuccess={onSuccess}
          onRetry={onRetry}
        />
      </div>

      {/* Manage by ID — fallback */}
      <details className="flex flex-col gap-2 rounded-lg border border-line/60 bg-bg-card2 p-3">
        <summary className="cursor-pointer text-sm font-medium text-ink-dim hover:text-ink">
          Manage by ID (advanced)
        </summary>
        <div className="flex flex-col gap-2 pt-2">
          <p className="text-xs text-ink-dim">
            Off-roster operations — useful when the target isn&apos;t in the
            live member list yet (e.g. just left, or a ban-grant target).
          </p>
          <ManageByIdBlock slug={slug} onSuccess={onSuccess} />
        </div>
      </details>
    </section>
  )
}

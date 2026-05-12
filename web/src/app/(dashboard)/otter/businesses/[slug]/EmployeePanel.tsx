'use client'
/**
 * EmployeePanel — Wave 7c-B client-side hire/fire/promote/demote panel.
 *
 * The four write surfaces all POST to `/api/otter/businesses/[slug]/employees/*`
 * which forwards to the bot's matching `employee.*` RPC verb. The bot owns
 * the Discord role mutations + the `business_owners` DB write — this
 * component is pure UI plus a `router.refresh()` on success so the
 * business detail page repaints with the new audit row.
 *
 * Sections:
 *  - **Hire**: free-form userId + rank select. Owner rank only appears when
 *    the viewer is a business owner (or bot owner).
 *  - **Current owners**: per-owner Promote (no-op surface — bot returns
 *    `already-at-top-rank`), Demote, Fire. Fire on an owner is rejected
 *    server-side with `cannot-fire-owner` — we render that as a clear hint.
 *  - **Manage by user ID**: free-form Promote / Demote / Fire form for staff
 *    we don't have a DB row for. Managers + employees live as pure Discord
 *    roles on the bot side, so there's no roster to enumerate from the
 *    panel's DB; the slash-command-equivalent surface is a typed input.
 *
 * Fire uses a "flip-to-confirm" pattern with a reason textarea — the action
 * stays one click for owners (where the cannot-fire-owner sentinel arrives
 * immediately) and two clicks (open → submit) for everyone else, with the
 * reason captured in the audit row.
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ServerForm } from '@/lib/forms/ServerForm'

export type RosterEntry = {
  /** Discord snowflake. */
  discordUserId: string
  /**
   * Effective rank as known to the panel DB. Today this is only `owner`
   * because the otter side doesn't carry a user-to-manager-or-employee
   * table — managers + employees are pure Discord roles. The bot RPC
   * returns the live effective rank in `data.{before,after}`.
   */
  rank: 'owner'
  /** ISO string. Render with `relTime()` upstream if needed. */
  addedAt: string | null
}

export type EmployeePanelProps = {
  slug: string
  /** Roster derived from `business_owners` on the server side. */
  roster: RosterEntry[]
  /** True when the viewer can hire someone as `owner` (business owner / bot owner). */
  canActAsOwner: boolean
}

function pillClass(extra: string): string {
  return `inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${extra}`
}

function shortId(id: string): string {
  // Discord IDs are 17-20 digits; show the trailing 4 for at-a-glance
  // distinguishing in a row of similarly-shaped numbers.
  return id.length > 8 ? `…${id.slice(-4)}` : id
}

// ───── Hire form ────────────────────────────────────────────────────────

function HireForm({
  slug,
  canActAsOwner,
}: {
  slug: string
  canActAsOwner: boolean
}): React.JSX.Element {
  const router = useRouter()
  return (
    <ServerForm
      action={`/api/otter/businesses/${slug}/employees/hire`}
      method="POST"
      onSuccess={() => router.refresh()}
      resetOnSuccess
      className="flex flex-wrap items-end gap-3"
    >
      <label className="flex flex-col gap-1 min-w-[14rem]">
        <span className="text-xs uppercase tracking-wider text-ink-dim">
          Discord user ID
        </span>
        <input
          name="userId"
          required
          pattern="\d{15,25}"
          placeholder="17–20 digit snowflake"
          className="rounded-md border border-line bg-bg-card2 px-3 py-1.5 font-mono text-sm"
        />
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

// ───── Single-action button form (Promote / Demote / Fire by user ID) ───

function ActionButton({
  slug,
  verb,
  userId,
  label,
  confirm,
  variant,
  reason,
}: {
  slug: string
  verb: 'promote' | 'demote' | 'fire'
  userId: string
  label: string
  confirm?: string
  variant: 'neutral' | 'warn' | 'danger'
  reason?: string
}): React.JSX.Element {
  const router = useRouter()
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
      onSuccess={() => router.refresh()}
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

// ───── Roster row with flip-to-confirm Fire ─────────────────────────────

function RosterRow({
  slug,
  entry,
}: {
  slug: string
  entry: RosterEntry
}): React.JSX.Element {
  const [confirmingFire, setConfirmingFire] = useState(false)
  const [reason, setReason] = useState('')
  const router = useRouter()
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-line bg-bg-card2 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className={pillClass('bg-rank-owner/15 text-rank-owner border-rank-owner/30')}>
          owner
        </span>
        <code className="font-mono text-xs text-ink-dim flex-1 min-w-0 truncate">
          {entry.discordUserId}
        </code>
        <span className="text-xs text-ink-dim font-mono">
          {shortId(entry.discordUserId)}
        </span>
        <div className="flex flex-wrap gap-1.5">
          <ActionButton
            slug={slug}
            verb="promote"
            userId={entry.discordUserId}
            label="Promote"
            variant="neutral"
          />
          <ActionButton
            slug={slug}
            verb="demote"
            userId={entry.discordUserId}
            label="Demote"
            variant="warn"
            confirm="Demote this owner one rung (owner → manager)?"
          />
          {!confirmingFire ? (
            <button
              type="button"
              onClick={() => setConfirmingFire(true)}
              className="rounded-md border border-err/40 bg-err/15 px-2.5 py-1 text-xs font-medium text-err hover:bg-err/25"
            >
              Fire…
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setConfirmingFire(false)
                setReason('')
              }}
              className="rounded-md border border-line bg-bg-card px-2.5 py-1 text-xs text-ink-dim hover:bg-bg-card2"
            >
              Cancel
            </button>
          )}
        </div>
      </div>
      {confirmingFire && (
        <ServerForm
          action={`/api/otter/businesses/${slug}/employees/fire`}
          method="POST"
          confirm="Fire this owner? This strips ALL business roles + clears their owner record."
          onSuccess={() => {
            setConfirmingFire(false)
            setReason('')
            router.refresh()
          }}
          className="flex flex-col gap-2 border-t border-line/50 pt-2"
        >
          <input type="hidden" name="userId" value={entry.discordUserId} />
          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wider text-ink-dim">
              Reason (recorded in audit)
            </span>
            <textarea
              name="reason"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              placeholder="Optional — shown in the audit row."
              className="rounded-md border border-line bg-bg-card2 px-3 py-1.5 text-sm"
            />
          </label>
          <p className="text-xs text-yellow-200">
            Note: firing an owner via the panel is rejected by the API
            (<code className="font-mono">cannot-fire-owner</code>) — demote
            them first.
          </p>
          <button
            type="submit"
            className="self-start rounded-md border border-err/40 bg-err/15 px-3 py-1.5 text-sm font-medium text-err hover:bg-err/25"
          >
            Confirm Fire
          </button>
        </ServerForm>
      )}
    </li>
  )
}

// ───── Free-form Manage-by-ID block ─────────────────────────────────────

function ManageByIdBlock({ slug }: { slug: string }): React.JSX.Element {
  const router = useRouter()
  const [verb, setVerb] = useState<'promote' | 'demote' | 'fire'>('promote')
  return (
    <ServerForm
      action={`/api/otter/businesses/${slug}/employees/${verb}`}
      method="POST"
      onResolveAction={() => `/api/otter/businesses/${slug}/employees/${verb}`}
      onSuccess={() => router.refresh()}
      resetOnSuccess
      className="flex flex-wrap items-end gap-3"
    >
      <label className="flex flex-col gap-1 min-w-[14rem]">
        <span className="text-xs uppercase tracking-wider text-ink-dim">
          Discord user ID
        </span>
        <input
          name="userId"
          required
          pattern="\d{15,25}"
          placeholder="17–20 digit snowflake"
          className="rounded-md border border-line bg-bg-card2 px-3 py-1.5 font-mono text-sm"
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

// ───── Public ──────────────────────────────────────────────────────────

export function EmployeePanel({
  slug,
  roster,
  canActAsOwner,
}: EmployeePanelProps): React.JSX.Element {
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
        <HireForm slug={slug} canActAsOwner={canActAsOwner} />
        {!canActAsOwner && (
          <p className="text-xs text-ink-dim italic">
            Only business owners (or bot owner) can hire someone as{' '}
            <code className="font-mono">owner</code>.
          </p>
        )}
      </div>

      {/* Roster — DB-known owners */}
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">
          Current owners
          <span className="text-xs text-ink-dim ml-2">
            (from <code className="font-mono">business_owners</code>)
          </span>
        </h3>
        {roster.length === 0 ? (
          <p className="text-xs text-ink-dim italic">
            No DB-recorded owners. Use Hire above or the bot&apos;s{' '}
            <code className="font-mono">/portal</code> to designate one.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {roster.map((entry) => (
              <RosterRow key={entry.discordUserId} slug={slug} entry={entry} />
            ))}
          </ul>
        )}
      </div>

      {/* Free-form manage by ID */}
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">Manage by user ID</h3>
        <p className="text-xs text-ink-dim">
          Managers + employees aren&apos;t enumerated here — they live as pure
          Discord roles on the bot. Enter the snowflake and pick an action.
        </p>
        <ManageByIdBlock slug={slug} />
      </div>
    </section>
  )
}

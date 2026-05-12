'use client'

/**
 * Self-service "Request a staff role" card on the profile editor.
 *
 * Rendered only when the editing user is viewing their OWN profile
 * (page.tsx gates this — sudo viewers editing someone else's profile
 * shouldn't be able to file a request on the target's behalf, since the
 * bot-side audit row would still stamp the actor on the staff_approvals
 * row anyway).
 *
 * Mirrors the bot's `/settings → Staff Role` flow:
 *   1. Pick a role from the 8 staff slugs.
 *   2. Optional "real / preferred name" + "reason" fields.
 *   3. POST to /api/squishy/staff/request — bot publishes the approval
 *      card to the staff thread and pings the reviewer.
 *
 * Renders a list of the user's currently pending requests above the
 * form so they don't file duplicates without seeing them first.
 */
import { useRouter } from 'next/navigation'
import { ServerForm } from '@/lib/forms/ServerForm'
import { STAFF_ROLE_OPTIONS, labelForSlug } from '@/lib/squishyStaffRoles'

export type PendingStaffRequest = {
  id: string
  roleSlug: string
  roleLabel: string
  realName: string | null
  reason: string | null
  createdAt: Date
}

const inputCls =
  'rounded border border-line bg-bg-card px-3 py-2 text-sm text-ink focus:outline-none focus:ring-1 focus:ring-accent'
const selectCls =
  'rounded border border-line bg-bg-card px-3 py-2 text-sm text-ink focus:outline-none focus:ring-1 focus:ring-accent'

function relTime(d: Date): string {
  const ms = Date.now() - d.getTime()
  const m = Math.floor(ms / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export function StaffRequestCard({
  pending,
}: {
  pending: PendingStaffRequest[]
}) {
  const router = useRouter()

  return (
    <section className="rounded-2xl border border-line bg-bg-card p-6 flex flex-col gap-4">
      <header className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-dim">
          Request a staff role
        </h2>
        <span className="text-[10px] uppercase tracking-wider text-accent border border-accent/40 bg-accent/10 rounded-full px-2 py-0.5">
          Self
        </span>
      </header>

      <p className="text-xs text-ink-dim leading-relaxed">
        Pick a role and submit — an admin will review it in Discord. You&apos;ll get a DM
        when they approve or deny. The same flow as the <code>/settings → Staff Role</code> button on the bot.
      </p>

      {pending.length > 0 && (
        <div className="rounded-md border border-warn/40 bg-warn/5 p-3 text-xs text-ink flex flex-col gap-1.5">
          <div className="text-warn font-medium">
            You already have {pending.length} pending request{pending.length === 1 ? '' : 's'}:
          </div>
          <ul className="flex flex-col gap-1 list-none">
            {pending.map((r) => (
              <li key={r.id} className="flex items-center gap-2 text-ink-dim">
                <span className="inline-flex items-center rounded-full border border-line px-2 py-0.5 text-[10px] uppercase tracking-wider">
                  {r.roleLabel}
                </span>
                <span className="text-[11px]">{relTime(r.createdAt)}</span>
              </li>
            ))}
          </ul>
          <div className="text-[11px] text-ink-dim mt-1">
            You can still submit another request below if you want a different role.
          </div>
        </div>
      )}

      <ServerForm
        action="/api/squishy/staff/request"
        method="POST"
        resetOnSuccess
        onSuccess={(data) => {
          const d = data as { data?: { roleLabel?: string } } | null
          const label = d?.data?.roleLabel ?? 'role'
          // eslint-disable-next-line no-alert
          alert(`Your request for ${label} has been submitted. An admin will review it shortly.`)
          router.refresh()
        }}
        className="flex flex-col gap-4"
      >
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wider text-ink-dim">
            Role <span className="text-err">*</span>
          </span>
          <select name="roleSlug" required className={selectCls} defaultValue="">
            <option value="" disabled>
              Pick a staff role…
            </option>
            {STAFF_ROLE_OPTIONS.map((o) => (
              <option key={o.slug} value={o.slug}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wider text-ink-dim">
            Real / preferred name (optional)
          </span>
          <input
            name="realName"
            type="text"
            maxLength={120}
            className={inputCls}
            placeholder="What should we call you when you're on staff?"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wider text-ink-dim">
            Why you want this role (optional)
          </span>
          <textarea
            name="reason"
            maxLength={1000}
            rows={3}
            className={inputCls}
            placeholder="Anything that helps the reviewer make a call (up to 1000 chars)."
          />
        </label>

        <div className="flex items-center justify-end gap-3">
          <button
            type="submit"
            className="rounded-md border border-accent/40 bg-accent/20 px-4 py-2 text-sm text-ink hover:bg-accent/30"
          >
            Submit request
          </button>
        </div>
      </ServerForm>
    </section>
  )
}

export { labelForSlug }

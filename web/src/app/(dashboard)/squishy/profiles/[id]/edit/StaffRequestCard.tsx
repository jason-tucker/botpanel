'use client'

/**
 * Self-service "Request a staff role" card on the profile editor.
 *
 * Rendered only when the editing user is viewing their OWN profile
 * (page.tsx gates this).
 *
 * Mirrors the bot's `/settings → Staff Role` flow: pick a department,
 * pick a tier (both optional, at least one required), optionally add
 * a real / preferred name, submit. Approval grants whichever roles
 * were picked plus the ITSRI Staff base role automatically.
 *
 * Pending requests are shown above the form so duplicates aren't
 * filed blindly.
 */
import { useRouter } from 'next/navigation'
import { ServerForm } from '@/lib/forms/ServerForm'
import { DEPARTMENT_OPTIONS, TIER_OPTIONS } from '@/lib/squishyStaffRoles'

export type PendingStaffRequest = {
  id: string
  departmentLabel: string | null
  tierLabel: string | null
  realName: string | null
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

function summarizeRequest(r: PendingStaffRequest): string {
  if (r.departmentLabel && r.tierLabel) return `${r.departmentLabel} · ${r.tierLabel}`
  return r.departmentLabel ?? r.tierLabel ?? 'staff'
}

export function StaffRequestCard({
  pending,
  isSudo,
}: {
  pending: PendingStaffRequest[]
  isSudo: boolean
}) {
  const router = useRouter()

  return (
    <section className="rounded-2xl border border-line bg-bg-card p-6 flex flex-col gap-4">
      <header className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-dim">
          {isSudo ? 'Grant yourself a staff role' : 'Request a staff role'}
        </h2>
        <span
          className={`text-[10px] uppercase tracking-wider rounded-full px-2 py-0.5 border ${
            isSudo
              ? 'text-ok border-ok/40 bg-ok/10'
              : 'text-accent border-accent/40 bg-accent/10'
          }`}
        >
          {isSudo ? 'Sudo · instant' : 'Self'}
        </span>
      </header>

      {isSudo ? (
        <p className="text-xs text-ink-dim leading-relaxed">
          You&apos;re sudo — picking a department / tier here{' '}
          <strong>grants the roles immediately</strong> (no review queue). The{' '}
          <strong>ITSRI Staff</strong> base role is granted too. Picks are idempotent — already
          having a role is treated as success.
        </p>
      ) : (
        <p className="text-xs text-ink-dim leading-relaxed">
          Pick a department, a tier, or both. An admin will review in Discord and you&apos;ll get a
          DM with the outcome. Approving also grants the <strong>ITSRI Staff</strong> base role
          automatically.
        </p>
      )}

      {pending.length > 0 && (
        <div className="rounded-md border border-warn/40 bg-warn/5 p-3 text-xs text-ink flex flex-col gap-1.5">
          <div className="text-warn font-medium">
            You already have {pending.length} pending request{pending.length === 1 ? '' : 's'}:
          </div>
          <ul className="flex flex-col gap-1 list-none">
            {pending.map((r) => (
              <li key={r.id} className="flex items-center gap-2 text-ink-dim">
                <span className="inline-flex items-center rounded-full border border-line px-2 py-0.5 text-[10px] uppercase tracking-wider">
                  {summarizeRequest(r)}
                </span>
                <span className="text-[11px]">{relTime(r.createdAt)}</span>
              </li>
            ))}
          </ul>
          <div className="text-[11px] text-ink-dim mt-1">
            You can still submit another below if you want a different department / tier.
          </div>
        </div>
      )}

      <ServerForm
        action="/api/squishy/staff/request"
        method="POST"
        resetOnSuccess
        onSuccess={(data) => {
          const d = data as
            | {
                data?: {
                  departmentLabel?: string | null
                  tierLabel?: string | null
                  autoApproved?: boolean
                  grants?: Array<{ roleKey: string; ok: boolean; error?: string }>
                }
              }
            | null
          const dept = d?.data?.departmentLabel ?? null
          const tier = d?.data?.tierLabel ?? null
          const what = dept && tier ? `${dept} · ${tier}` : dept ?? tier ?? 'request'

          if (d?.data?.autoApproved) {
            const grants = d.data.grants ?? []
            const failed = grants.filter((g) => !g.ok)
            const msg =
              failed.length === 0
                ? `Granted ${what} + ITSRI Staff. Picks were instant — no review queue.`
                : `Granted ${what} + ITSRI Staff, but ${failed.length} grant(s) failed: ${failed
                    .map((g) => `${g.roleKey} (${g.error ?? 'error'})`)
                    .join(', ')}.\n\nProvision the missing role keys via /sudo → Settings → Staff Roles → Provision & link and retry.`
            // eslint-disable-next-line no-alert
            alert(msg)
          } else {
            // eslint-disable-next-line no-alert
            alert(
              `Your request for ${what} has been submitted. An admin will review it shortly. Approving will also grant the ITSRI Staff base role.`,
            )
          }
          router.refresh()
        }}
        className="flex flex-col gap-4"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wider text-ink-dim">Department (optional)</span>
            <select name="departmentSlug" className={selectCls} defaultValue="">
              <option value="">— None —</option>
              {DEPARTMENT_OPTIONS.map((o) => (
                <option key={o.slug} value={o.slug}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wider text-ink-dim">Tier (optional)</span>
            <select name="tierSlug" className={selectCls} defaultValue="">
              <option value="">— None —</option>
              {TIER_OPTIONS.map((o) => (
                <option key={o.slug} value={o.slug}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>

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

        <p className="text-[11px] text-ink-dim">
          Pick at least one of department or tier before submitting.
        </p>

        <div className="flex items-center justify-end gap-3">
          <button
            type="submit"
            className={`rounded-md border px-4 py-2 text-sm text-ink ${
              isSudo
                ? 'border-ok/40 bg-ok/20 hover:bg-ok/30'
                : 'border-accent/40 bg-accent/20 hover:bg-accent/30'
            }`}
          >
            {isSudo ? 'Grant immediately' : 'Submit request'}
          </button>
        </div>
      </ServerForm>
    </section>
  )
}

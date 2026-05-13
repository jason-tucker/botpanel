'use client'

/**
 * Shared staff-role grant/revoke + approve/deny controls.
 *
 * Originally inline in `app/(dashboard)/sudo/StaffApprovalControls.tsx`;
 * lifted here so the new `/squishy/members/[id]` editor can reuse the
 * exact same form rendering and submit semantics. The /sudo file now
 * re-exports from this module so existing call sites stay intact.
 *
 * Four exports:
 *
 *  - `<ApproveButton id, onSuccess? />` — green Approve button. POSTs
 *    to `/api/sudo/staff-approvals/[id]/approve`. The response body
 *    includes the bot's `grant` reply — if `grantOk` is false the
 *    operator gets a one-shot `alert()` so a partial failure (queue
 *    cleared but Discord rejected) doesn't disappear silently.
 *  - `<DenyButton id, onSuccess? />` — gray Deny with `confirm: …`
 *    since denial closes the request. POSTs `…/deny`.
 *  - `<DirectGrantForm defaultUserId?, onSuccess? />` — staff direct
 *    grant form. When `defaultUserId` is set the userId field is hidden
 *    and pre-filled (used from the members editor where the URL already
 *    pins the target).
 *  - `<DirectRevokeForm defaultUserId?, onSuccess? />` — same shape as
 *    grant. Revoking is `confirm`-wrapped because it's destructive.
 *
 * All four use `<ServerForm>` for free CSRF + disabled-while-submitting
 * + inline 4xx error banner. `_format=json` is set on every form so the
 * routes get JSON bodies.
 *
 * `onSuccess`: callers default to `router.refresh()` so the surrounding
 * page re-fetches the underlying tables. Pages that already do their
 * own re-render plumbing (e.g. the members editor) can pass a no-op or
 * an alternative refetch to avoid a double-refresh.
 */
import { useRouter } from 'next/navigation'
import { ServerForm } from '@/lib/forms/ServerForm'

/** Mirror of `squishybot/src/services/staffRoles.ts` — must be kept in sync. */
export const STAFF_ROLE_SLUGS: ReadonlyArray<{ slug: string; label: string }> = [
  { slug: 'tier_1',     label: 'Tier 1' },
  { slug: 'tier_2',     label: 'Tier 2' },
  { slug: 'tier_3',     label: 'Tier 3' },
  { slug: 'help_desk',  label: 'Help Desk' },
  { slug: 'onsites',    label: 'Onsites' },
  { slug: 'security',   label: 'Security' },
  { slug: 'sales',      label: 'Sales' },
  { slug: 'leadership', label: 'Leadership' },
]

const inputCls =
  'rounded border border-line bg-bg-card px-2 py-1 font-mono text-xs text-ink focus:outline-none focus:ring-1 focus:ring-accent'
const selectCls =
  'rounded border border-line bg-bg-card px-2 py-1 text-xs text-ink focus:outline-none focus:ring-1 focus:ring-accent'

function summarizeBotReply(reply: unknown): string {
  if (!reply || typeof reply !== 'object') return 'unknown bot reply'
  const r = reply as Record<string, unknown>
  if (r.ok === false) {
    const err = typeof r.error === 'string' ? r.error : 'error'
    const det = typeof r.details === 'string' ? r.details : ''
    return det ? `${err}: ${det}` : err
  }
  if (r.ok === true) return 'ok'
  return 'unknown bot reply'
}

export function ApproveButton({ id, onSuccess }: { id: string; onSuccess?: () => void }) {
  const router = useRouter()
  return (
    <ServerForm
      action={`/api/sudo/staff-approvals/${encodeURIComponent(id)}/approve`}
      method="POST"
      className="inline"
      onSuccess={(data) => {
        const d = data as { grantOk?: boolean; grant?: unknown } | null
        // Queue is cleared either way, but the role grant may have failed
        // on the Discord side. Surface that so the operator knows to apply
        // it manually — the spec calls this out explicitly.
        if (d && d.grantOk === false) {
          // eslint-disable-next-line no-alert
          alert(
            `Approved + queue cleared, but the Discord grant failed:\n\n${summarizeBotReply(d.grant)}\n\nApply the role manually.`,
          )
        }
        if (onSuccess) onSuccess()
        else router.refresh()
      }}
    >
      <button
        type="submit"
        className="rounded border border-ok/30 bg-ok/10 px-2 py-0.5 text-xs text-ok hover:bg-ok/20"
        title="Approve + grant the role via the bot"
        aria-label={`Approve staff request ${id}`}
      >
        Approve
      </button>
    </ServerForm>
  )
}

export function DenyButton({ id, onSuccess }: { id: string; onSuccess?: () => void }) {
  const router = useRouter()
  return (
    <ServerForm
      action={`/api/sudo/staff-approvals/${encodeURIComponent(id)}/deny`}
      method="POST"
      confirm="Deny this staff request? The requester will be notified via the bot's existing flow when they next interact."
      className="inline"
      onSuccess={() => {
        if (onSuccess) onSuccess()
        else router.refresh()
      }}
    >
      <button
        type="submit"
        className="rounded border border-line bg-bg-card2 px-2 py-0.5 text-xs text-ink-dim hover:bg-bg-card2/70"
        title="Mark this request denied — no role is granted"
        aria-label={`Deny staff request ${id}`}
      >
        Deny
      </button>
    </ServerForm>
  )
}

export function DirectGrantForm({
  defaultUserId,
  onSuccess,
}: {
  defaultUserId?: string
  onSuccess?: () => void
}) {
  const router = useRouter()
  // When defaultUserId is set we hide the input — the surrounding page
  // already pins the target. The field is still submitted (as a hidden
  // input) so the API route's existing snowflake-validated body shape
  // doesn't have to learn about the new "URL-derived" caller pattern.
  const pinnedTarget = Boolean(defaultUserId)
  return (
    <ServerForm
      action="/api/sudo/staff/grant"
      method="POST"
      className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-line bg-bg-card2/40"
      onSuccess={(data) => {
        const d = data as { grantOk?: boolean; grant?: unknown } | null
        if (d && d.grantOk === false) {
          // eslint-disable-next-line no-alert
          alert(`Direct grant failed:\n\n${summarizeBotReply(d.grant)}`)
          return
        }
        if (onSuccess) onSuccess()
        else router.refresh()
      }}
    >
      <input type="hidden" name="_format" value="json" />
      <label className="text-xs uppercase tracking-wider text-ink-dim">
        Direct grant
      </label>
      {pinnedTarget ? (
        <input type="hidden" name="userId" value={defaultUserId} />
      ) : (
        <input
          type="text"
          name="userId"
          placeholder="Discord user id"
          pattern="\d{15,25}"
          title="Discord user id (15-25 digit snowflake)"
          required
          className={`${inputCls} w-56`}
        />
      )}
      <select name="roleKey" required defaultValue="tier_1" className={selectCls}>
        {STAFF_ROLE_SLUGS.map((r) => (
          <option key={r.slug} value={r.slug}>
            {r.label}
          </option>
        ))}
      </select>
      <button
        type="submit"
        className="rounded border border-ok/30 bg-ok/10 px-3 py-1 text-xs text-ok hover:bg-ok/20"
      >
        Grant role
      </button>
      <span className="text-[11px] text-ink-dim">
        Skips the queue — for grants you&apos;ve already decided offline.
      </span>
    </ServerForm>
  )
}

export function DirectRevokeForm({
  defaultUserId,
  onSuccess,
}: {
  defaultUserId?: string
  onSuccess?: () => void
}) {
  const router = useRouter()
  const pinnedTarget = Boolean(defaultUserId)
  return (
    <ServerForm
      action="/api/sudo/staff/revoke"
      method="POST"
      confirm="Revoke this staff role? The user keeps every other role they hold."
      className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-line bg-bg-card2/40"
      onSuccess={(data) => {
        const d = data as { revokeOk?: boolean; revoke?: unknown } | null
        if (d && d.revokeOk === false) {
          // eslint-disable-next-line no-alert
          alert(`Direct revoke failed:\n\n${summarizeBotReply(d.revoke)}`)
          return
        }
        if (onSuccess) onSuccess()
        else router.refresh()
      }}
    >
      <input type="hidden" name="_format" value="json" />
      <label className="text-xs uppercase tracking-wider text-ink-dim">
        Direct revoke
      </label>
      {pinnedTarget ? (
        <input type="hidden" name="userId" value={defaultUserId} />
      ) : (
        <input
          type="text"
          name="userId"
          placeholder="Discord user id"
          pattern="\d{15,25}"
          title="Discord user id (15-25 digit snowflake)"
          required
          className={`${inputCls} w-56`}
        />
      )}
      <select name="roleKey" required defaultValue="tier_1" className={selectCls}>
        {STAFF_ROLE_SLUGS.map((r) => (
          <option key={r.slug} value={r.slug}>
            {r.label}
          </option>
        ))}
      </select>
      <button
        type="submit"
        className="rounded border border-err/30 bg-err/10 px-3 py-1 text-xs text-err hover:bg-err/20"
      >
        Revoke role
      </button>
    </ServerForm>
  )
}

'use client'

/**
 * Client controls for the Sudo Users card on `/sudo`.
 *
 * Two surfaces:
 *  - `<AddSudoUserForm>` — single Discord-ID input + Add button at the top
 *    of the card. POSTs to `/api/sudo/users`. On 2xx → `router.refresh()`
 *    so the server-rendered table re-fetches with the new row included
 *    (no stale-data flash); on 4xx → inline error.
 *  - `<RevokeButton>` — per-DB-row trash button (env rows don't render
 *    one — env grants come from `.env`, can't be revoked here). DELETE
 *    `/api/sudo/users/<id>`, with a confirm dialog because revoking a
 *    sudo grant is the kind of thing you want to *mean* to do.
 *
 * Both rely on `<ServerForm>` from `@/lib/forms/ServerForm` (agent T's
 * surface) which handles CSRF token injection + surfaces 4xx error
 * bodies inline.
 */
import { useRouter } from 'next/navigation'
import { ServerForm } from '@/lib/forms/ServerForm'

export function AddSudoUserForm() {
  const router = useRouter()
  return (
    <ServerForm
      action="/api/sudo/users"
      method="POST"
      onSuccess={() => router.refresh()}
      className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-line bg-bg-card2/40"
    >
      <label className="text-xs uppercase tracking-wider text-ink-dim">
        Add sudo user
      </label>
      <input
        type="text"
        name="userId"
        placeholder="Discord user id (snowflake)"
        pattern="\d{15,25}"
        title="Discord user id (15-25 digit snowflake)"
        required
        className="w-72 rounded border border-line bg-bg-card px-2 py-1 font-mono text-xs text-ink focus:outline-none focus:ring-1 focus:ring-accent"
      />
      <button
        type="submit"
        className="rounded border border-line bg-bg-card px-3 py-1 text-xs text-ink hover:bg-bg-card2"
      >
        Grant sudo
      </button>
      <span className="text-[11px] text-ink-dim">
        Bot-owner only. Grants a row in <code className="font-mono">sudo_users</code> —{' '}
        <code className="font-mono">SUDO_USER_IDS</code> env entries are unaffected.
      </span>
    </ServerForm>
  )
}

export function RevokeButton({ userId }: { userId: string }) {
  const router = useRouter()
  return (
    <ServerForm
      action={`/api/sudo/users/${encodeURIComponent(userId)}`}
      method="DELETE"
      confirm={`Revoke sudo from <@${userId}>? This deletes the DB row only — any env-source grant for the same user stays in place.`}
      onSuccess={() => router.refresh()}
      className="inline"
    >
      <button
        type="submit"
        className="rounded border border-err/30 bg-err/10 px-2 py-0.5 text-xs text-err hover:bg-err/20"
        title="Remove from sudo_users"
        aria-label={`Revoke sudo from ${userId}`}
      >
        Revoke
      </button>
    </ServerForm>
  )
}

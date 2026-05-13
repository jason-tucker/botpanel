'use client'

/**
 * `<SudoToggleCard>` — single-button toggle for a member's sudo bit.
 *
 * POSTs `{ enabled }` to `/api/squishy/members/[id]/sudo`, which inserts
 * or deletes a `sudo_users` row. The button label flips based on
 * `isCurrentlySudo`; on success we `router.refresh()` so the server
 * component re-reads the table.
 *
 * Env-source grants (`SUDO_USER_IDS`) can't be revoked from the panel —
 * we surface that as a disabled-state hint when `sourceIsEnv` is true.
 */
import { useRouter } from 'next/navigation'
import { ServerForm } from '@/lib/forms/ServerForm'

const btnGrant =
  'inline-flex items-center justify-center rounded-md border border-ok/30 bg-ok/10 px-3 py-1.5 text-sm text-ok hover:bg-ok/20'
const btnRevoke =
  'inline-flex items-center justify-center rounded-md border border-err/30 bg-err/10 px-3 py-1.5 text-sm text-err hover:bg-err/20'

export function SudoToggleCard({
  userId,
  isCurrentlySudo,
  sourceIsEnv,
}: {
  userId: string
  isCurrentlySudo: boolean
  sourceIsEnv: boolean
}) {
  const router = useRouter()
  const nextEnabled = !isCurrentlySudo

  if (sourceIsEnv) {
    return (
      <div className="rounded-md border border-line bg-bg-card2/40 p-3 text-sm text-ink-dim flex flex-col gap-1">
        <span>
          <span className="text-ink">Granted via env</span>
          {' '}— <code className="font-mono text-xs">SUDO_USER_IDS</code>
          {' '}grants can&apos;t be revoked here. Edit the panel .env and
          redeploy.
        </span>
      </div>
    )
  }

  return (
    <ServerForm
      action={`/api/squishy/members/${userId}/sudo`}
      method="POST"
      confirm={
        nextEnabled
          ? 'Grant sudo to this user? They will gain access to every sudo-gated panel surface and bot command.'
          : 'Revoke sudo from this user? They lose every sudo-only capability immediately.'
      }
      onSuccess={() => router.refresh()}
      className="flex items-center gap-3"
    >
      <input type="hidden" name="_format" value="json" />
      <input type="hidden" name="enabled" value={String(nextEnabled)} />
      <button
        type="submit"
        className={nextEnabled ? btnGrant : btnRevoke}
        aria-label={nextEnabled ? 'Grant sudo' : 'Revoke sudo'}
      >
        {nextEnabled ? 'Grant sudo' : 'Revoke sudo'}
      </button>
      <span className="text-xs text-ink-dim">
        Currently {isCurrentlySudo ? 'a sudo user' : 'not sudo'}.
      </span>
    </ServerForm>
  )
}

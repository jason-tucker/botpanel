'use client'

/**
 * Sudo write controls for /squishy/stats — the only interactive (client)
 * pieces on the Activity Stats overview page. Everything routes through
 * `<ServerForm>` (CSRF, JSON body, fieldset-disable, error banner — see
 * that module for the full rundown) and `router.refresh()`s on success so
 * a toggle is reflected immediately without a full page reload. Follows
 * the same shape as `squishy/games/GamesWriteUI.tsx`.
 */
import { useRouter } from 'next/navigation'
import { ServerForm } from '@/lib/forms/ServerForm'
import { buttonClasses } from '@/components/ui'

/** Big primary CTA on the feature-off "enable" card. */
export function EnableStatsButton() {
  const router = useRouter()
  return (
    <ServerForm
      action="/api/squishy/stats/settings"
      method="POST"
      onSuccess={() => router.refresh()}
    >
      <input type="hidden" name="_format" value="json" />
      <input type="hidden" name="enabled" value="true" />
      <button type="submit" className={buttonClasses({ variant: 'primary', size: 'lg' })}>
        Enable Activity Stats
      </button>
    </ServerForm>
  )
}

/** Disable tracking — destructive-ish (stops new data, doesn't delete
 *  anything), so it gets a confirm but stays a plain secondary button. */
export function DisableStatsButton() {
  const router = useRouter()
  return (
    <ServerForm
      action="/api/squishy/stats/settings"
      method="POST"
      confirm="Disable activity tracking? Existing history is kept — this only stops new events from being recorded. You can re-enable any time."
      onSuccess={() => router.refresh()}
    >
      <input type="hidden" name="_format" value="json" />
      <input type="hidden" name="enabled" value="false" />
      <button type="submit" className={buttonClasses({ variant: 'secondary', size: 'sm' })}>
        Disable tracking
      </button>
    </ServerForm>
  )
}

/** Pause/resume the history backfill loop. Label reflects current state. */
export function BackfillToggleButton({ backfillEnabled }: { backfillEnabled: boolean }) {
  const router = useRouter()
  return (
    <ServerForm
      action="/api/squishy/stats/backfill"
      method="POST"
      onSuccess={() => router.refresh()}
    >
      <input type="hidden" name="_format" value="json" />
      <input type="hidden" name="enabled" value={backfillEnabled ? 'false' : 'true'} />
      <button type="submit" className={buttonClasses({ variant: backfillEnabled ? 'secondary' : 'primary', size: 'sm' })}>
        {backfillEnabled ? 'Pause backfill' : 'Start backfill'}
      </button>
    </ServerForm>
  )
}

/** Wipes backfilled history + progress rows — clearly destructive, gets a
 *  confirm that spells out exactly what it deletes. */
export function ResetBackfillButton() {
  const router = useRouter()
  return (
    <ServerForm
      action="/api/squishy/stats/backfill"
      method="POST"
      confirm="Reset backfill? This deletes ALL backfilled message + emoji history (everything from before tracking was first enabled) and clears per-channel progress. Live-tracked data since then is untouched. This can't be undone — backfill would have to re-scan from scratch."
      onSuccess={() => router.refresh()}
    >
      <input type="hidden" name="_format" value="json" />
      <input type="hidden" name="reset" value="true" />
      <button type="submit" className={buttonClasses({ variant: 'danger', size: 'sm' })}>
        Reset backfill (clears backfilled history)
      </button>
    </ServerForm>
  )
}

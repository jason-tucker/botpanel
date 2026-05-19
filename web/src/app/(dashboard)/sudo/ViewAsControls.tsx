'use client'

/**
 * Client controls for the "View As" card on `/sudo`.
 *
 * Two surfaces:
 *  - `<StartViewAsForm>` — `<MemberPicker>` + Start button. POSTs to
 *    `/api/sudo/view-as`; on success `router.push('/me')` so the actor
 *    lands on the impersonated user's dashboard immediately.
 *  - `<ExitViewAsForm>` — shown when View-As is already active. DELETE
 *    the same endpoint; on success `router.refresh()` so the banner
 *    + sidebar update without a full page reload.
 *
 * Both rely on `<ServerForm>` for CSRF token handling + inline error
 * surfacing (server-rendered 4xx error becomes a banner above the form).
 */
import { useRouter } from 'next/navigation'
import { ServerForm } from '@/lib/forms/ServerForm'
import { MemberPicker } from '@/components/pickers/MemberPicker'

export function StartViewAsForm() {
  const router = useRouter()
  return (
    <ServerForm
      action="/api/sudo/view-as"
      method="POST"
      onSuccess={() => {
        // Hard refresh to /me so server-rendered shells (banner, sidebar)
        // re-resolve access against the freshly-written cookie. push()
        // alone would keep the prior layout cache.
        router.push('/me')
        router.refresh()
      }}
      className="flex flex-wrap items-end gap-2 px-4 py-3 border-b border-line bg-bg-card2/40"
    >
      <div className="flex flex-col gap-1">
        <label className="text-xs uppercase tracking-wider text-ink-dim">
          Target user
        </label>
        <div className="w-72">
          <MemberPicker name="userId" placeholder="Search members…" bot="squishy" />
        </div>
      </div>
      <button
        type="submit"
        className="rounded border border-line bg-bg-card px-3 py-1.5 text-xs text-ink hover:bg-bg-card2"
      >
        Start View-As
      </button>
      <span className="text-[11px] text-ink-dim flex-1">
        Audit rows during View-As record both your account and the
        impersonated user.
      </span>
    </ServerForm>
  )
}

export function ExitViewAsForm({ viewingLabel }: { viewingLabel: string }) {
  const router = useRouter()
  return (
    <ServerForm
      action="/api/sudo/view-as"
      method="DELETE"
      onSuccess={() => {
        router.push('/sudo')
        router.refresh()
      }}
      className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-line bg-warn/10"
    >
      <span className="text-sm text-ink">
        Currently viewing as <span className="font-medium">@{viewingLabel}</span>.
      </span>
      <button
        type="submit"
        className="rounded border border-err/40 bg-err/10 px-3 py-1 text-xs text-err hover:bg-err/20"
      >
        Exit View-As
      </button>
    </ServerForm>
  )
}

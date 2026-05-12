'use client'

/**
 * Sudo write controls for /squishy/hubs.
 *
 * Every write surface here wraps `<ServerForm>` (`@/lib/forms/ServerForm`)
 * so we get CSRF, JSON-body opt-in, disabled-while-submitting, and a
 * 4xx error banner for free. After every successful submit we call
 * `router.refresh()` so the server-rendered table re-fetches.
 *
 * Exports:
 *  - `<LockAllHubsControls>` — top-of-page guild-wide lock/unlock pair.
 *  - `<AddHubForm>` — top-of-page DB-only "Add hub" form.
 *  - `<HubLockToggle>` — per-row lock/unlock button (one or the other,
 *    depending on the current `lockdownUntil` state).
 *  - `<EditHubForm>` — collapsible per-row label + position editor.
 *  - `<RemoveHubButton>` — per-row flip-to-confirm Remove.
 *
 * All endpoints return `{reply}` (RPC routes) or `{ok, row}` (DB routes)
 * but the UI doesn't introspect — it just refreshes the server view to
 * pick up the new state.
 */
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { ServerForm } from '@/lib/forms/ServerForm'

const inputCls =
  'w-full rounded-md border border-line bg-bg-card2 px-2 py-1.5 text-sm placeholder:text-ink-dim/50 focus:outline-none focus:ring-1 focus:ring-accent'
const labelCls = 'text-[11px] uppercase tracking-wider text-ink-dim'
const btnPrimary =
  'inline-flex items-center px-3 py-1.5 text-sm rounded-lg border border-line bg-bg-card2 text-ink hover:bg-bg-card2/70 transition-colors'
const btnDanger =
  'inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md border border-err/40 bg-err/10 text-err hover:bg-err/20 transition-colors'
const btnSuccess =
  'inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md border border-ok/40 bg-ok/10 text-ok hover:bg-ok/20 transition-colors'
const btnGhost =
  'text-[11px] text-ink-dim hover:text-ink underline-offset-2 hover:underline self-start'

// ─── Lock all / unlock all ─────────────────────────────────────────

export function LockAllHubsControls({ guildLocked }: { guildLocked: boolean }) {
  const router = useRouter()
  return (
    <div className="rounded-xl border border-line bg-bg-card p-4">
      <div className="flex items-center justify-between mb-2 gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-medium">Guild-wide lockdown</h3>
          <p className="text-[11px] text-ink-dim">
            {guildLocked
              ? 'Lockdown is currently active — every hub denies Connect to @everyone.'
              : 'Locks every hub at once. Bot persists the policy until the timer expires or you unlock.'}
          </p>
        </div>
        <span className="text-[11px] text-ink-dim">sudo · audit-logged</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <ServerForm
          action="/api/squishy/hubs/lockdown-all"
          method="POST"
          confirm="Lock ALL hubs guild-wide? @everyone will lose Connect on every hub voice channel."
          onSuccess={() => router.refresh()}
          className="inline-flex items-center gap-2"
        >
          <input type="hidden" name="_format" value="json" />
          <input type="hidden" name="locked" value="true" />
          <label className={labelCls} htmlFor="lockall-mins">
            Minutes
          </label>
          <input
            id="lockall-mins"
            name="durationMinutes"
            type="number"
            min={1}
            max={43200}
            defaultValue={60}
            className="w-20 rounded-md border border-line bg-bg-card2 px-2 py-1 text-sm"
          />
          <button
            type="submit"
            className="inline-flex items-center px-3 py-1.5 text-sm rounded-lg border border-err/40 bg-err/10 text-err hover:bg-err/20 transition-colors"
          >
            Lock all hubs
          </button>
        </ServerForm>
        <ServerForm
          action="/api/squishy/hubs/lockdown-all"
          method="POST"
          confirm="Unlock ALL hubs guild-wide?"
          onSuccess={() => router.refresh()}
          className="inline-flex items-center"
        >
          <input type="hidden" name="_format" value="json" />
          <input type="hidden" name="locked" value="false" />
          <button
            type="submit"
            className="inline-flex items-center px-3 py-1.5 text-sm rounded-lg border border-ok/40 bg-ok/10 text-ok hover:bg-ok/20 transition-colors"
          >
            Unlock all hubs
          </button>
        </ServerForm>
      </div>
    </div>
  )
}

// ─── Add hub ───────────────────────────────────────────────────────

export function AddHubForm() {
  const router = useRouter()
  return (
    <div className="rounded-xl border border-line bg-bg-card p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium">Add hub channel</h3>
        <span className="text-[11px] text-ink-dim">sudo · audit-logged · DB-only</span>
      </div>
      <ServerForm
        action="/api/squishy/hubs"
        method="POST"
        onSuccess={() => router.refresh()}
        resetOnSuccess
        className="flex flex-col gap-3"
      >
        <input type="hidden" name="_format" value="json" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="flex flex-col gap-1">
            <label className={labelCls} htmlFor="hub-voiceChannelId">
              Voice channel ID
            </label>
            <input
              id="hub-voiceChannelId"
              name="voiceChannelId"
              type="text"
              required
              inputMode="numeric"
              pattern="\d{15,25}"
              placeholder="123456789012345678"
              className={inputCls}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className={labelCls} htmlFor="hub-label">
              Label (optional)
            </label>
            <input
              id="hub-label"
              name="label"
              type="text"
              maxLength={100}
              placeholder="➕ Create Voice"
              className={inputCls}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className={labelCls} htmlFor="hub-position">
              Position (optional)
            </label>
            <input
              id="hub-position"
              name="position"
              type="number"
              step={1}
              placeholder="0"
              className={inputCls}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className={labelCls} htmlFor="hub-categoryId">
              Category ID (optional)
            </label>
            <input
              id="hub-categoryId"
              name="categoryId"
              type="text"
              inputMode="numeric"
              pattern="\d{15,25}"
              placeholder="(uses channel.auto_voice_category)"
              className={inputCls}
            />
          </div>
        </div>
        <p className="text-[11px] text-ink-dim">
          DB-only registration — the channel must already exist on Discord.
          Bot picks up the new row immediately via{' '}
          <code className="font-mono">hub.refresh_cache</code>; no restart needed.
        </p>
        <div>
          <button type="submit" className={btnPrimary}>
            Add hub
          </button>
        </div>
      </ServerForm>
    </div>
  )
}

// ─── Per-row lockdown ──────────────────────────────────────────────

export function HubLockToggle({
  hubId,
  locked,
}: {
  hubId: string
  locked: boolean
}) {
  const router = useRouter()
  if (locked) {
    return (
      <ServerForm
        action={`/api/squishy/hubs/${hubId}/lockdown`}
        method="POST"
        confirm="Unlock this hub now?"
        onSuccess={() => router.refresh()}
        className="inline"
      >
        <input type="hidden" name="_format" value="json" />
        <input type="hidden" name="locked" value="false" />
        <button type="submit" className={btnSuccess}>
          Unlock
        </button>
      </ServerForm>
    )
  }
  return (
    <ServerForm
      action={`/api/squishy/hubs/${hubId}/lockdown`}
      method="POST"
      confirm="Lock this hub? Defaults to 60 minutes — change the input first if you want longer."
      onSuccess={() => router.refresh()}
      className="inline-flex items-center gap-1"
    >
      <input type="hidden" name="_format" value="json" />
      <input type="hidden" name="locked" value="true" />
      <input
        name="durationMinutes"
        type="number"
        min={1}
        max={43200}
        defaultValue={60}
        className="w-14 rounded-md border border-line bg-bg-card2 px-1.5 py-0.5 text-xs"
        title="Minutes"
        aria-label="Lockdown minutes"
      />
      <button type="submit" className={btnDanger}>
        Lock
      </button>
    </ServerForm>
  )
}

// ─── Per-row edit ──────────────────────────────────────────────────

export function EditHubForm({
  hubId,
  label,
  position,
}: {
  hubId: string
  label: string
  position: number
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-[11px] text-accent hover:underline self-start"
      >
        Edit
      </button>
    )
  }
  return (
    <div className="flex flex-col gap-2 mt-1 rounded-md border border-line bg-bg-card2 p-2 min-w-[14rem]">
      <ServerForm
        action={`/api/squishy/hubs/${hubId}`}
        method="PATCH"
        onSuccess={() => {
          setOpen(false)
          router.refresh()
        }}
        className="flex flex-col gap-2"
      >
        <input type="hidden" name="_format" value="json" />
        <div className="flex flex-col gap-1">
          <label className={labelCls} htmlFor={`hub-edit-label-${hubId}`}>
            Label
          </label>
          <input
            id={`hub-edit-label-${hubId}`}
            name="label"
            type="text"
            defaultValue={label}
            maxLength={100}
            className={inputCls}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className={labelCls} htmlFor={`hub-edit-pos-${hubId}`}>
            Position
          </label>
          <input
            id={`hub-edit-pos-${hubId}`}
            name="position"
            type="number"
            step={1}
            defaultValue={position}
            className={inputCls}
          />
        </div>
        <div className="flex items-center gap-2">
          <button type="submit" className={btnPrimary}>
            Save
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className={btnGhost}
          >
            Cancel
          </button>
        </div>
      </ServerForm>
    </div>
  )
}

// ─── Per-row remove (flip-to-confirm) ──────────────────────────────

export function RemoveHubButton({ hubId }: { hubId: string }) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className={btnDanger}
        title="Remove this hub"
      >
        Remove
      </button>
    )
  }
  return (
    <ServerForm
      action={`/api/squishy/hubs/${hubId}`}
      method="DELETE"
      onSuccess={() => {
        setConfirming(false)
        router.refresh()
      }}
      className="inline-flex items-center gap-1"
    >
      <span className="text-xs text-err">Confirm?</span>
      <button
        type="submit"
        className="rounded-md border border-err/40 bg-err/15 hover:bg-err/25 px-2 py-1 text-xs text-err font-medium"
      >
        Yes
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="rounded-md border border-line text-ink-dim text-xs px-2 py-1 hover:text-ink"
      >
        Cancel
      </button>
    </ServerForm>
  )
}

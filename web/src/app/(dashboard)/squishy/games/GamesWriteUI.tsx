'use client'

/**
 * Sudo write controls for /squishy/games.
 *
 * Three islands consumed by the server-rendered games page:
 *
 *   - `<AddGameForm />`         — top-of-page add form. POSTs to
 *                                 /api/squishy/games. Includes optional
 *                                 channelId / view roleId / pingRoleId /
 *                                 playCooldownSeconds / autoArchiveDays.
 *   - `<EditGameForm />`        — collapsible inline editor on each row.
 *                                 PATCHes /api/squishy/games/[id].
 *   - `<RemoveGameButton />`    — flip-to-confirm (two-stage) DELETE.
 *                                 First click swaps the label to "Confirm
 *                                 remove" with a Cancel; second click
 *                                 actually submits. A 4s timeout reverts
 *                                 to the default state so a stray click
 *                                 can't be revisited as a delete an hour
 *                                 later. Matches the spec's "flip-to-
 *                                 confirm" requirement (rather than the
 *                                 RolesWriteUI window.confirm pattern).
 *
 * All write surfaces go through `<ServerForm>` — see RolesWriteUI for the
 * full rundown of what that wrapper does (CSRF, JSON body, fieldset
 * disable, error banner). After every successful write we
 * `router.refresh()` so the server page re-runs its DB read and renders
 * the updated table; the bot-side cache refresh is handled API-side, so
 * we don't have to wait on it client-side.
 */
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ServerForm } from '@/lib/forms/ServerForm'
import { ChannelPicker } from '@/components/pickers/ChannelPicker'
import { RolePicker } from '@/components/pickers/RolePicker'

const inputCls =
  'w-full rounded-md border border-line bg-bg-card2 px-2 py-1.5 text-sm placeholder:text-ink-dim/50 focus:outline-none focus:ring-1 focus:ring-accent'
const labelCls = 'text-[11px] uppercase tracking-wider text-ink-dim'
const btnPrimary =
  'inline-flex items-center px-3 py-1.5 text-sm rounded-lg border border-line bg-bg-card2 text-ink hover:bg-bg-card2/70 transition-colors'
const btnDanger =
  'inline-flex items-center px-2 py-1 text-xs rounded-md border border-err/40 bg-err/10 text-err hover:bg-err/20 transition-colors'
const btnGhost =
  'text-[11px] text-ink-dim hover:text-ink underline-offset-2 hover:underline'

/** Shared field set rendered by both Add and Edit forms. */
function GameFields({
  idPrefix,
  defaults,
}: {
  idPrefix: string
  defaults?: {
    name?: string
    channelId?: string | null
    roleId?: string | null
    pingRoleId?: string | null
    playCooldownSeconds?: number | null
    autoArchiveDays?: number | null
  }
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <div className="flex flex-col gap-1 md:col-span-2">
        <label className={labelCls} htmlFor={`${idPrefix}-name`}>
          Name
        </label>
        <input
          id={`${idPrefix}-name`}
          name="name"
          type="text"
          required
          maxLength={100}
          defaultValue={defaults?.name ?? ''}
          placeholder="e.g. Overwatch"
          className={inputCls}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className={labelCls} htmlFor={`${idPrefix}-channelId`}>
          Channel (optional)
        </label>
        <ChannelPicker
          id={`${idPrefix}-channelId`}
          name="channelId"
          types={['text', 'announcement', 'forum']}
          defaultValue={defaults?.channelId ?? ''}
          allowNone
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className={labelCls} htmlFor={`${idPrefix}-roleId`}>
          View role (optional)
        </label>
        <RolePicker
          id={`${idPrefix}-roleId`}
          name="roleId"
          defaultValue={defaults?.roleId ?? ''}
          allowNone
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className={labelCls} htmlFor={`${idPrefix}-pingRoleId`}>
          Ping role (optional)
        </label>
        <RolePicker
          id={`${idPrefix}-pingRoleId`}
          name="pingRoleId"
          defaultValue={defaults?.pingRoleId ?? ''}
          allowNone
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className={labelCls} htmlFor={`${idPrefix}-playCooldownSeconds`}>
          /play cooldown (seconds, optional)
        </label>
        <input
          id={`${idPrefix}-playCooldownSeconds`}
          name="playCooldownSeconds"
          type="number"
          min={0}
          step={1}
          defaultValue={defaults?.playCooldownSeconds ?? ''}
          placeholder="1800"
          className={inputCls}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className={labelCls} htmlFor={`${idPrefix}-autoArchiveDays`}>
          Auto-archive (days, optional)
        </label>
        <input
          id={`${idPrefix}-autoArchiveDays`}
          name="autoArchiveDays"
          type="number"
          min={0}
          step={1}
          defaultValue={defaults?.autoArchiveDays ?? ''}
          placeholder="0 = off"
          className={inputCls}
        />
      </div>
    </div>
  )
}

export function AddGameForm() {
  const router = useRouter()
  return (
    <div className="rounded-xl border border-line bg-bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium">Add game</h3>
        <span className="text-[11px] text-ink-dim">sudo · audit-logged</span>
      </div>
      <ServerForm
        action="/api/squishy/games"
        method="POST"
        onSuccess={() => router.refresh()}
        className="flex flex-col gap-3"
      >
        <input type="hidden" name="_format" value="json" />
        <GameFields idPrefix="add-game" />
        <p className="text-[11px] text-ink-dim">
          Only <strong>name</strong> is required. The bot reads the games table
          live, and we ping its cache-refresh hook after the insert so /play
          and /games pick this row up immediately.
        </p>
        <div>
          <button type="submit" className={btnPrimary}>
            Add game
          </button>
        </div>
      </ServerForm>
    </div>
  )
}

export function EditGameForm({
  id,
  name,
  channelId,
  roleId,
  pingRoleId,
  playCooldownSeconds,
  autoArchiveDays,
}: {
  id: string
  name: string
  channelId: string | null
  roleId: string | null
  pingRoleId: string | null
  playCooldownSeconds: number | null
  autoArchiveDays: number | null
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-[11px] text-accent hover:underline"
      >
        Edit
      </button>
    )
  }
  return (
    <div className="flex flex-col gap-2 mt-2 rounded-md border border-line bg-bg-card2 p-3">
      <ServerForm
        action={`/api/squishy/games/${id}`}
        method="PATCH"
        onSuccess={() => {
          setOpen(false)
          router.refresh()
        }}
        className="flex flex-col gap-3"
      >
        <input type="hidden" name="_format" value="json" />
        <GameFields
          idPrefix={`edit-${id}`}
          defaults={{
            name,
            channelId,
            roleId,
            pingRoleId,
            playCooldownSeconds,
            autoArchiveDays,
          }}
        />
        <p className="text-[11px] text-ink-dim">
          Pick "— None —" or clear a number field to unset it. Saving fires
          the bot cache-refresh hook.
        </p>
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

/**
 * Flip-to-confirm remove. First click swaps to a red "Confirm remove" +
 * Cancel pair; second click submits the DELETE. A timeout reverts to the
 * pre-flip state so a forgotten click can't be turned into a delete later.
 */
export function RemoveGameButton({ id, name }: { id: string; name: string }) {
  const router = useRouter()
  const [armed, setArmed] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Auto-revert after 4s so a forgotten click doesn't sit armed forever.
  useEffect(() => {
    if (!armed) return
    timerRef.current = setTimeout(() => setArmed(false), 4000)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [armed])

  if (!armed) {
    return (
      <button
        type="button"
        onClick={() => setArmed(true)}
        className={btnDanger}
        title={`Remove ${name}`}
      >
        Remove
      </button>
    )
  }

  return (
    <span className="inline-flex items-center gap-1">
      <ServerForm
        action={`/api/squishy/games/${id}`}
        method="DELETE"
        onSuccess={() => {
          setArmed(false)
          router.refresh()
        }}
        className="inline"
      >
        <button type="submit" className={btnDanger}>
          Confirm remove
        </button>
      </ServerForm>
      <button
        type="button"
        onClick={() => setArmed(false)}
        className={btnGhost}
      >
        Cancel
      </button>
    </span>
  )
}

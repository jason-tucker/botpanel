'use client'

/**
 * Per-channel control popover for `/squishy/voice`. Sits inside each
 * `<ChannelCard>` in `VoiceLive.tsx` and only renders when the snapshot
 * marked `canControl: true` for the viewer (the API routes still re-gate
 * server-side so the worst a snoop can do is poke the URLs directly and
 * get a 403).
 *
 * The component is intentionally self-contained: every action routes
 * through its own `<ServerForm>` against `/api/squishy/voice/[id]/...`,
 * which handles CSRF + rate-limit + audit on the panel side and forwards
 * to the bot via `callBot`. On a successful submit we call the optional
 * `onMutated` callback so the parent can `router.refresh()` the page
 * shell — the live SSE feed picks up most events on its own (lock,
 * hide, owner_changed, channel_deleted), but a rename has no bot event
 * yet so we refresh to be safe.
 *
 * Permission split inside the controls:
 *  - Rename / lock / hide / disconnect — anyone with `canControl`
 *  - Transfer / Delete — owner-or-sudo (the API routes enforce this; we
 *    surface the buttons unconditionally and let the server's 403 land
 *    in the form error banner if a host clicks them).
 */
import { useState } from 'react'
import { ServerForm } from '@/lib/forms/ServerForm'
import { MemberPicker } from '@/components/pickers/MemberPicker'

const inputCls =
  'w-full rounded-md border border-line bg-bg-card2 px-3 py-1.5 text-sm text-ink placeholder:text-ink-dim focus:outline-none focus:ring-1 focus:ring-line'
const labelCls = 'text-xs uppercase tracking-wider text-ink-dim'
const btnPrimary =
  'inline-flex items-center justify-center rounded-md border border-line bg-bg-card2 px-3 py-1.5 text-sm hover:bg-bg-card3'
const btnDanger =
  'inline-flex items-center justify-center rounded-md border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-sm text-red-200 hover:bg-red-500/20'
const btnGhost =
  'inline-flex items-center justify-center rounded-md px-3 py-1.5 text-sm text-ink-dim hover:text-ink'

export type VoiceControlsProps = {
  voiceChannelId: string
  currentName: string
  ownerUserId: string
  hostUserIds: string[]
  members: { userId: string }[]
  locked: boolean
  hidden: boolean
  onMutated?: () => void
}

export function VoiceControls(props: VoiceControlsProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={btnPrimary}
      >
        Controls
      </button>
    )
  }
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-line bg-bg-card2 p-4 w-full">
      <header className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-ink-dim">
          Controls
        </h3>
        <button type="button" onClick={() => setOpen(false)} className={btnGhost}>
          Close
        </button>
      </header>
      <RenameForm {...props} />
      <ToggleRow {...props} />
      <HostsList ownerUserId={props.ownerUserId} hostUserIds={props.hostUserIds} />
      <TransferForm {...props} />
      <DisconnectList {...props} />
      <DeleteButton {...props} />
    </div>
  )
}

function RenameForm({
  voiceChannelId,
  currentName,
  onMutated,
}: VoiceControlsProps) {
  return (
    <ServerForm
      action={`/api/squishy/voice/${voiceChannelId}/rename`}
      method="POST"
      onSuccess={() => onMutated?.()}
      className="flex flex-col gap-1.5"
    >
      <label className={labelCls} htmlFor={`vc-rename-${voiceChannelId}`}>
        Rename
      </label>
      <div className="flex items-center gap-2">
        <input
          id={`vc-rename-${voiceChannelId}`}
          name="newName"
          type="text"
          maxLength={100}
          defaultValue={currentName}
          required
          className={inputCls}
        />
        <button type="submit" className={btnPrimary}>
          Save
        </button>
      </div>
    </ServerForm>
  )
}

function ToggleRow({
  voiceChannelId,
  locked,
  hidden,
  onMutated,
}: VoiceControlsProps) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <ServerForm
        action={`/api/squishy/voice/${voiceChannelId}/lock`}
        method="POST"
        onSuccess={() => onMutated?.()}
        className="inline"
      >
        <input type="hidden" name="locked" value={(!locked).toString()} />
        <button type="submit" className={btnPrimary}>
          {locked ? 'Unlock' : 'Lock'}
        </button>
      </ServerForm>
      <ServerForm
        action={`/api/squishy/voice/${voiceChannelId}/hide`}
        method="POST"
        onSuccess={() => onMutated?.()}
        className="inline"
      >
        <input type="hidden" name="hidden" value={(!hidden).toString()} />
        <button type="submit" className={btnPrimary}>
          {hidden ? 'Show' : 'Hide'}
        </button>
      </ServerForm>
    </div>
  )
}

function HostsList({
  ownerUserId,
  hostUserIds,
}: { ownerUserId: string; hostUserIds: string[] }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className={labelCls}>Hosts</div>
      {hostUserIds.length === 0 ? (
        <p className="text-xs text-ink-dim">
          No hosts yet. (Owner: <span className="font-mono">{ownerUserId}</span>) Use Discord
          to add hosts — host management lands in a later wave.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {hostUserIds.map((h) => (
            <li key={h} className="flex items-baseline justify-between text-xs">
              <span className="font-mono text-ink">{h}</span>
              <span className="text-ink-dim">host</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function TransferForm({
  voiceChannelId,
  onMutated,
}: VoiceControlsProps) {
  return (
    <ServerForm
      action={`/api/squishy/voice/${voiceChannelId}/transfer`}
      method="POST"
      onSuccess={() => onMutated?.()}
      confirm="Transfer ownership? The new owner gets full control of this room immediately and any active grace window is cancelled."
      className="flex flex-col gap-1.5"
    >
      <div className={labelCls}>Transfer ownership</div>
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <MemberPicker name="newOwnerUserId" placeholder="Search members…" />
        </div>
        <button type="submit" className={btnPrimary}>
          Transfer
        </button>
      </div>
    </ServerForm>
  )
}

function DisconnectList({
  voiceChannelId,
  members,
  ownerUserId,
  onMutated,
}: VoiceControlsProps) {
  if (members.length === 0) {
    return (
      <div className="flex flex-col gap-1.5">
        <div className={labelCls}>Disconnect a member</div>
        <p className="text-xs text-ink-dim">(empty)</p>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-1.5">
      <div className={labelCls}>Disconnect a member</div>
      <ul className="flex flex-col gap-1">
        {members.map((m) => (
          <li
            key={m.userId}
            className="flex items-center justify-between gap-2 rounded-md border border-line bg-bg-card3 px-2.5 py-1.5"
          >
            <span className="font-mono text-xs text-ink truncate">
              {m.userId}
              {m.userId === ownerUserId && (
                <span className="ml-2 text-ink-dim">(owner)</span>
              )}
            </span>
            <ServerForm
              action={`/api/squishy/voice/${voiceChannelId}/disconnect`}
              method="POST"
              onSuccess={() => onMutated?.()}
              confirm={`Disconnect ${m.userId} from this voice channel?`}
              className="inline"
            >
              <input type="hidden" name="userId" value={m.userId} />
              <button
                type="submit"
                className={btnDanger}
                aria-label={`Disconnect ${m.userId}`}
              >
                ✕
              </button>
            </ServerForm>
          </li>
        ))}
      </ul>
    </div>
  )
}

function DeleteButton({
  voiceChannelId,
  onMutated,
}: VoiceControlsProps) {
  return (
    <ServerForm
      action={`/api/squishy/voice/${voiceChannelId}`}
      method="DELETE"
      onSuccess={() => onMutated?.()}
      confirm="Delete this voice channel? This removes BOTH the voice channel and its attached text channel. This cannot be undone."
      className="inline"
    >
      <button type="submit" className={btnDanger}>
        Delete channel
      </button>
    </ServerForm>
  )
}

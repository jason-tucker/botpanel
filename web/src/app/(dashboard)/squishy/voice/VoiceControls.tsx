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
  'w-full rounded-md border border-line bg-bg-card2 px-3 py-1.5 text-sm text-ink placeholder:text-ink-dim focus:outline-none focus:ring-1 focus:ring-line transition-colors duration-150'
const labelCls = 'text-xs uppercase tracking-wider text-ink-dim'
const btnPrimary =
  'inline-flex items-center justify-center rounded-md border border-line bg-bg-card2 px-3 py-1.5 text-sm hover:bg-bg-card3 transition-colors duration-150'
const btnDanger =
  'inline-flex items-center justify-center rounded-md border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-sm text-red-200 hover:bg-red-500/20 transition-colors duration-150'
const btnGhost =
  'inline-flex items-center justify-center rounded-md px-3 py-1.5 text-sm text-ink-dim hover:text-ink transition-colors duration-150'

export type ResolvedUserLite = {
  username: string
  displayName: string
  avatarUrl: string
}

/**
 * Inline chip for a userId — avatar + @displayName when we have it,
 * monospace raw id fallback so the panel still works pre-resolve.
 * Mirrors the chip in VoiceLive's render but local so this file stays
 * self-contained.
 */
function MemberInline({
  userId,
  resolved,
  suffix,
}: {
  userId: string
  resolved?: Map<string, ResolvedUserLite>
  suffix?: string
}) {
  const r = resolved?.get(userId)
  if (!r) {
    return (
      <span className="font-mono text-xs text-ink truncate inline-flex items-baseline gap-1.5">
        <span className="truncate">{userId}</span>
        {suffix && <span className="text-ink-dim">{suffix}</span>}
      </span>
    )
  }
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs text-ink truncate"
      title={`${userId} · @${r.username}`}
    >
      <img
        src={r.avatarUrl}
        alt=""
        width={18}
        height={18}
        className="rounded-full ring-1 ring-line shrink-0"
      />
      <span className="truncate">@{r.displayName || r.username}</span>
      {suffix && <span className="text-ink-dim shrink-0">{suffix}</span>}
    </span>
  )
}

export type VoiceControlsProps = {
  voiceChannelId: string
  currentName: string
  ownerUserId: string
  hostUserIds: string[]
  members: { userId: string }[]
  locked: boolean
  hidden: boolean
  onMutated?: () => void
  /**
   * Optional userId → display chip data. Threaded through from VoiceLive
   * so the Disconnect / Hosts / owner-shown-in-hosts surfaces render
   * `[avatar] @displayName` instead of raw snowflakes. Falls back to
   * monospace id when an entry is missing (e.g. mid-fetch).
   */
  resolved?: Map<string, ResolvedUserLite>
}

export function VoiceControls(props: VoiceControlsProps): React.JSX.Element {
  const [open, setOpen] = useState(false)

  // The same button morphs from "Controls" → "Close" in place. The panel
  // expands below the header on open via a CSS grid trick (grid-template-
  // rows transition between 0fr → 1fr) — keeps it pure-CSS, no layout
  // shift outside the card.
  return (
    <div
      className={`flex flex-col w-full overflow-hidden rounded-xl transition-all duration-200 ${
        open ? 'border border-line bg-bg-card2' : ''
      }`}
    >
      <div className={`flex items-center justify-end ${open ? 'p-3' : ''}`}>
        {open && (
          <span className="mr-auto text-sm font-semibold uppercase tracking-wider text-ink-dim">
            Controls
          </span>
        )}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={`${btnPrimary} ${open ? '!border-line/60' : ''}`}
          aria-expanded={open}
          aria-label={open ? 'Close controls' : 'Open controls'}
        >
          <span className="transition-opacity duration-150">
            {open ? '✕ Close' : 'Controls'}
          </span>
        </button>
      </div>
      <div
        className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${
          open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
        }`}
        aria-hidden={!open}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="flex flex-col gap-4 px-4 pb-4">
            <RenameForm {...props} />
            <ToggleRow {...props} />
            <HostsList
              ownerUserId={props.ownerUserId}
              hostUserIds={props.hostUserIds}
              resolved={props.resolved}
            />
            <TransferForm {...props} />
            <DisconnectList {...props} />
            <DeleteButton {...props} />
          </div>
        </div>
      </div>
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
  resolved,
}: { ownerUserId: string; hostUserIds: string[]; resolved?: Map<string, ResolvedUserLite> }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className={labelCls}>Hosts</div>
      {hostUserIds.length === 0 ? (
        <p className="text-xs text-ink-dim flex items-baseline gap-1.5 flex-wrap">
          <span>No hosts yet. (Owner:</span>
          <MemberInline userId={ownerUserId} resolved={resolved} />
          <span>) Use Discord to add hosts — host management lands in a later wave.</span>
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {hostUserIds.map((h) => (
            <li
              key={h}
              className="flex items-center justify-between gap-2 rounded-md border border-line bg-bg-card3 px-2.5 py-1.5 transition-colors duration-150 hover:bg-bg-card3/70"
            >
              <MemberInline userId={h} resolved={resolved} />
              <span className="text-xs text-ink-dim shrink-0">host</span>
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
  resolved,
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
        {members.map((m) => {
          const isOwner = m.userId === ownerUserId
          const r = resolved?.get(m.userId)
          const friendly = r ? `@${r.displayName || r.username}` : m.userId
          return (
          <li
            key={m.userId}
            className="flex items-center justify-between gap-2 rounded-md border border-line bg-bg-card3 px-2.5 py-1.5 transition-colors duration-150 hover:bg-bg-card3/70"
          >
            <MemberInline
              userId={m.userId}
              resolved={resolved}
              suffix={isOwner ? '(owner)' : undefined}
            />
            <ServerForm
              action={`/api/squishy/voice/${voiceChannelId}/disconnect`}
              method="POST"
              onSuccess={() => onMutated?.()}
              confirm={`Disconnect ${friendly} from this voice channel?`}
              className="inline"
            >
              <input type="hidden" name="userId" value={m.userId} />
              <button
                type="submit"
                className={btnDanger}
                aria-label={`Disconnect ${friendly}`}
              >
                ✕
              </button>
            </ServerForm>
          </li>
          )
        })}
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

'use client'

/**
 * `<VoicePresenceCard>` — current-VC presence for a target member.
 *
 * Lists every `auto_channels` row the target has a relationship to —
 * owner / acting-owner / host / currently-in. Each row gets a couple of
 * inline action buttons:
 *
 *  - "Force-disconnect" — POST to `/api/squishy/voice/[id]/disconnect`
 *    with `{ userId: targetUserId }` so the existing route's gate fires
 *    against the actual VC (the route already supports a body-supplied
 *    user id; sudo gate is enforced server-side).
 *  - "Transfer to this user" — POST `/api/squishy/voice/[id]/transfer`
 *    with `{ newOwnerUserId: targetUserId }`. Only shown for channels
 *    where the target is NOT already the owner.
 *
 * If the channels list is empty we render an italic "not in a voice
 * channel" hint instead of an empty grid.
 */
import { useRouter } from 'next/navigation'
import { ServerForm } from '@/lib/forms/ServerForm'

export type VoiceChannelRow = {
  voiceChannelId: string
  textChannelId: string
  channelName: string
  ownerUserId: string
  isOwner: boolean
  isHost: boolean
  isActingOwner: boolean
  isMember: boolean
}

const btnDisconnect =
  'inline-flex items-center rounded border border-err/30 bg-err/10 px-2 py-0.5 text-xs text-err hover:bg-err/20'
const btnTransfer =
  'inline-flex items-center rounded border border-line bg-bg-card2 px-2 py-0.5 text-xs text-ink hover:bg-bg-card2/70'

function RoleChips({ row }: { row: VoiceChannelRow }) {
  const chips: { label: string; tone: 'owner' | 'host' | 'member' }[] = []
  if (row.isOwner) chips.push({ label: 'owner', tone: 'owner' })
  if (row.isActingOwner) chips.push({ label: 'acting owner', tone: 'owner' })
  if (row.isHost) chips.push({ label: 'host', tone: 'host' })
  if (row.isMember) chips.push({ label: 'in channel', tone: 'member' })
  return (
    <div className="flex flex-wrap items-center gap-1">
      {chips.map((c) => (
        <span
          key={c.label}
          className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${
            c.tone === 'owner'
              ? 'border-accent/30 bg-accent/15 text-accent'
              : c.tone === 'host'
                ? 'border-line bg-bg-card2 text-ink'
                : 'border-ok/30 bg-ok/15 text-ok'
          }`}
        >
          {c.label}
        </span>
      ))}
    </div>
  )
}

export function VoicePresenceCard({
  userId,
  channels,
}: {
  userId: string
  channels: VoiceChannelRow[]
}) {
  const router = useRouter()

  if (channels.length === 0) {
    return (
      <div className="text-sm text-ink-dim italic">
        Not in a voice channel and isn&apos;t the owner/host of any active
        auto channel.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {channels.map((c) => (
        <div
          key={c.voiceChannelId}
          className="rounded-md border border-line bg-bg-card p-3 flex flex-col gap-2"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm text-ink truncate">{c.channelName}</span>
              <span className="font-mono text-[11px] text-ink-dim">
                {c.voiceChannelId}
              </span>
            </div>
            <RoleChips row={c} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {c.isMember && (
              <ServerForm
                action={`/api/squishy/voice/${c.voiceChannelId}/disconnect`}
                method="POST"
                confirm="Force-disconnect this user from the voice channel? They can re-join from Discord at any time."
                onSuccess={() => router.refresh()}
                className="inline"
              >
                <input type="hidden" name="_format" value="json" />
                <input type="hidden" name="userId" value={userId} />
                <button type="submit" className={btnDisconnect}>
                  Force-disconnect
                </button>
              </ServerForm>
            )}
            {!c.isOwner && (
              <ServerForm
                action={`/api/squishy/voice/${c.voiceChannelId}/transfer`}
                method="POST"
                confirm={`Transfer ownership of "${c.channelName}" to this user?`}
                onSuccess={() => router.refresh()}
                className="inline"
              >
                <input type="hidden" name="_format" value="json" />
                <input type="hidden" name="newOwnerUserId" value={userId} />
                <button type="submit" className={btnTransfer}>
                  Transfer ownership to this user
                </button>
              </ServerForm>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

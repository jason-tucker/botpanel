'use client'
/**
 * BusinessAdminControls — client-side edit affordances for the per-business
 * detail page. Server component passes pre-loaded `owners` + `mappings` +
 * gate signals (`isBotOwner`, `userRank`) so the read-side render stays
 * server-rendered; this component only takes over for the interactive
 * forms.
 *
 * Two cards:
 *  - <OwnersCard>: bot-owner-only "Add owner" form + per-row Remove (with
 *    confirm). Non-owner viewers see the read-only list of owners (also
 *    rendered here so the live-update on add/remove via `router.refresh()`
 *    re-renders the same DOM the server painted).
 *  - <RoleMappingsCard>: bot-owner OR business-owner "Add mapping" form
 *    plus per-row inline Edit (rank + flags) + Remove. Other-rank viewers
 *    see the read-only table.
 *
 * All forms call `router.refresh()` on success — the server re-renders
 * with the updated rows. No optimistic updates: low volume + audit-log
 * symmetry matters more than perceived latency here.
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ServerForm } from '@/lib/forms/ServerForm'
import { MemberPicker } from '@/components/pickers/MemberPicker'
import {
  rankColor,
  rankLabel,
  compareRank,
  relTime,
} from '@/lib/util/otterFormat'
import type { BusinessRank } from '@/lib/auth/perms'

export type Owner = {
  id: string
  discordUserId: string
  addedAt: Date | string | null
}

export type Mapping = {
  id: string
  roleId: string
  roleName: string | null
  rank: BusinessRank
  isBase: boolean
  autoGrantEmployee: boolean
  minRankToAssign: BusinessRank
  label: string | null
}

const RANKS: BusinessRank[] = ['owner', 'manager', 'employee']

function pillClass(extra: string): string {
  return `inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${extra}`
}

// ───── Owners ──────────────────────────────────────────────────────────

function AddOwnerForm({ slug }: { slug: string }): React.JSX.Element {
  const router = useRouter()
  return (
    <ServerForm
      action={`/api/otter/businesses/${slug}/owners`}
      method="POST"
      onSuccess={() => router.refresh()}
      resetOnSuccess
      className="flex flex-wrap items-end gap-3"
    >
      <label className="flex flex-col gap-1 text-xs text-ink-dim flex-1 min-w-[14rem]">
        <span>Member</span>
        <MemberPicker
          name="discordUserId"
          bot="otter"
          placeholder="Search members…"
        />
      </label>
      <button
        type="submit"
        className="rounded-lg border border-accent/40 bg-accent/15 hover:bg-accent/25 px-4 py-2 text-sm text-accent font-medium"
      >
        Add owner
      </button>
    </ServerForm>
  )
}

function RemoveOwnerButton({
  slug,
  ownerId,
}: {
  slug: string
  ownerId: string
}): React.JSX.Element {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded-md border border-err/30 bg-err/10 hover:bg-err/20 px-2 py-1 text-xs text-err"
        title="Remove this owner"
      >
        Remove
      </button>
    )
  }

  return (
    <ServerForm
      action={`/api/otter/businesses/${slug}/owners/${ownerId}`}
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

export function OwnersCard({
  slug,
  owners,
  isBotOwner,
}: {
  slug: string
  owners: Owner[]
  isBotOwner: boolean
}): React.JSX.Element {
  return (
    <section className="rounded-2xl border border-line bg-bg-card p-5 flex flex-col gap-3">
      <h2 className="text-xs uppercase tracking-wider text-ink-dim">
        Owners <span className="text-ink">({owners.length})</span>
      </h2>
      {isBotOwner && <AddOwnerForm slug={slug} />}
      {owners.length === 0 ? (
        <p className="text-ink-dim text-sm">No owners recorded.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {owners.map((o) => (
            <li
              key={o.id}
              className="flex flex-wrap items-center gap-3 justify-between rounded-lg border border-line bg-bg-card2 px-3 py-2"
            >
              <code className="font-mono text-sm">{o.discordUserId}</code>
              <span className="text-xs text-ink-dim font-mono">
                {`<@${o.discordUserId}>`}
              </span>
              <span className="text-xs text-ink-dim">
                added {relTime(o.addedAt)}
              </span>
              {isBotOwner && (
                <RemoveOwnerButton slug={slug} ownerId={o.id} />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// ───── Role mappings ───────────────────────────────────────────────────

function AddMappingForm({ slug }: { slug: string }): React.JSX.Element {
  const router = useRouter()
  return (
    <ServerForm
      action={`/api/otter/businesses/${slug}/role-mappings`}
      method="POST"
      onSuccess={() => router.refresh()}
      resetOnSuccess
      className="grid grid-cols-1 sm:grid-cols-2 gap-3"
    >
      <label className="flex flex-col gap-1 text-xs text-ink-dim">
        <span>Discord role ID</span>
        <input
          type="text"
          name="roleId"
          required
          pattern="\d{15,25}"
          placeholder="e.g. 987654321098765432"
          className="rounded-lg border border-line bg-bg-card2 px-3 py-2 text-sm text-ink placeholder:text-ink-dim/70 focus:outline-none focus:ring-1 focus:ring-accent font-mono"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-ink-dim">
        <span>Role name (display)</span>
        <input
          type="text"
          name="roleName"
          required
          maxLength={200}
          placeholder="e.g. Manager"
          className="rounded-lg border border-line bg-bg-card2 px-3 py-2 text-sm text-ink placeholder:text-ink-dim/70 focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-ink-dim">
        <span>Rank</span>
        <select
          name="rank"
          required
          defaultValue="employee"
          className="rounded-lg border border-line bg-bg-card2 px-3 py-2 text-sm text-ink focus:outline-none focus:ring-1 focus:ring-accent"
        >
          {RANKS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-ink-dim">
        <span>Min rank to assign</span>
        <select
          name="minRankToAssign"
          defaultValue="manager"
          className="rounded-lg border border-line bg-bg-card2 px-3 py-2 text-sm text-ink focus:outline-none focus:ring-1 focus:ring-accent"
        >
          {RANKS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2 text-xs text-ink">
        <input
          type="checkbox"
          name="isBase"
          value="true"
          className="rounded border-line bg-bg-card2"
        />
        <span>
          <span className="font-medium">Base role</span> — primary role for this
          rank
        </span>
      </label>
      <label className="flex items-center gap-2 text-xs text-ink">
        <input
          type="checkbox"
          name="autoGrantEmployee"
          value="true"
          className="rounded border-line bg-bg-card2"
        />
        <span>
          <span className="font-medium">Auto-grant employee</span> on assign
        </span>
      </label>
      <div className="sm:col-span-2 flex justify-end">
        <button
          type="submit"
          className="rounded-lg border border-accent/40 bg-accent/15 hover:bg-accent/25 px-4 py-2 text-sm text-accent font-medium"
        >
          Add / update mapping
        </button>
      </div>
    </ServerForm>
  )
}

function EditMappingRow({
  slug,
  mapping,
  onClose,
}: {
  slug: string
  mapping: Mapping
  onClose: () => void
}): React.JSX.Element {
  const router = useRouter()
  return (
    <ServerForm
      action={`/api/otter/businesses/${slug}/role-mappings/${mapping.id}`}
      method="PATCH"
      onSuccess={() => {
        onClose()
        router.refresh()
      }}
      className="grid grid-cols-1 sm:grid-cols-2 gap-3"
    >
      <label className="flex flex-col gap-1 text-xs text-ink-dim">
        <span>Rank</span>
        <select
          name="rank"
          defaultValue={mapping.rank}
          className="rounded-lg border border-line bg-bg-card2 px-3 py-2 text-sm text-ink focus:outline-none focus:ring-1 focus:ring-accent"
        >
          {RANKS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-ink-dim">
        <span>Min rank to assign</span>
        <select
          name="minRankToAssign"
          defaultValue={mapping.minRankToAssign}
          className="rounded-lg border border-line bg-bg-card2 px-3 py-2 text-sm text-ink focus:outline-none focus:ring-1 focus:ring-accent"
        >
          {RANKS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2 text-xs text-ink">
        <input
          type="checkbox"
          name="isBase"
          value="true"
          defaultChecked={mapping.isBase}
          className="rounded border-line bg-bg-card2"
        />
        <span>Base role</span>
      </label>
      <label className="flex items-center gap-2 text-xs text-ink">
        <input
          type="checkbox"
          name="autoGrantEmployee"
          value="true"
          defaultChecked={mapping.autoGrantEmployee}
          className="rounded border-line bg-bg-card2"
        />
        <span>Auto-grant employee</span>
      </label>
      <div className="sm:col-span-2 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-line text-ink-dim text-sm px-3 py-1.5 hover:text-ink"
        >
          Cancel
        </button>
        <button
          type="submit"
          className="rounded-lg border border-accent/40 bg-accent/15 hover:bg-accent/25 px-4 py-1.5 text-sm text-accent font-medium"
        >
          Save
        </button>
      </div>
    </ServerForm>
  )
}

function RemoveMappingButton({
  slug,
  mappingId,
}: {
  slug: string
  mappingId: string
}): React.JSX.Element {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded-md border border-err/30 bg-err/10 hover:bg-err/20 px-2 py-1 text-xs text-err"
        title="Remove this mapping"
      >
        Remove
      </button>
    )
  }
  return (
    <ServerForm
      action={`/api/otter/businesses/${slug}/role-mappings/${mappingId}`}
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

function MappingRowView({
  slug,
  mapping,
  canEdit,
}: {
  slug: string
  mapping: Mapping
  canEdit: boolean
}): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  if (editing) {
    return (
      <tr className="border-t border-line align-top">
        <td colSpan={7} className="py-3 pr-3">
          <div className="rounded-lg border border-line bg-bg-card2 p-3 flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-3 text-xs text-ink-dim">
              <span className="font-medium text-ink">
                {mapping.roleName ?? '—'}
              </span>
              <code className="font-mono">{mapping.roleId}</code>
            </div>
            <EditMappingRow
              slug={slug}
              mapping={mapping}
              onClose={() => setEditing(false)}
            />
          </div>
        </td>
      </tr>
    )
  }
  return (
    <tr className="border-t border-line align-top">
      <td className="py-2 pr-3">
        <div className="font-medium">{mapping.roleName ?? '—'}</div>
        {mapping.label && (
          <div className="text-xs text-ink-dim">{mapping.label}</div>
        )}
      </td>
      <td className="py-2 pr-3">
        <span className={pillClass(rankColor(mapping.rank))}>
          {rankLabel(mapping.rank)}
        </span>
      </td>
      <td className="py-2 pr-3">
        <span className={pillClass(rankColor(mapping.minRankToAssign))}>
          {rankLabel(mapping.minRankToAssign)}
        </span>
      </td>
      <td className="py-2 pr-3 text-ink-dim">
        {mapping.autoGrantEmployee ? 'yes' : '—'}
      </td>
      <td className="py-2 pr-3 text-ink-dim">{mapping.isBase ? 'yes' : '—'}</td>
      <td className="py-2 pr-3 font-mono text-xs text-ink-dim">
        {mapping.roleId}
      </td>
      {canEdit && (
        <td className="py-2 pr-3">
          <div className="flex items-center gap-2 justify-end">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded-md border border-line text-ink-dim text-xs px-2 py-1 hover:text-ink"
            >
              Edit
            </button>
            <RemoveMappingButton slug={slug} mappingId={mapping.id} />
          </div>
        </td>
      )}
    </tr>
  )
}

// ───── Sync roles ──────────────────────────────────────────────────────

/**
 * SyncRolesCard — owner-only "Sync roles to Discord" button. POSTs to
 * `/api/otter/businesses/[slug]/sync-roles`, which calls the bot's
 * `business.sync_roles` RPC verb to reconcile every member of this
 * business with their expected Discord role for their rank.
 *
 * Renders nothing for non-owner viewers (matching the API gate — bot
 * owner does NOT pass this gate either; only the business owner can
 * trigger the sync). The result strip stays mounted across submits so
 * the user can see the last reconciliation's counts.
 */
export function SyncRolesCard({
  slug,
  isOwner,
}: {
  slug: string
  isOwner: boolean
}): React.JSX.Element | null {
  type SyncResult =
    | { ok: true; data: { added: number; removed: number; skipped: string[] } }
    | { ok: false; error: string }

  const [result, setResult] = useState<SyncResult | null>(null)

  if (!isOwner) return null

  return (
    <section className="rounded-2xl border border-line bg-bg-card p-5 flex flex-col gap-3">
      <h2 className="text-xs uppercase tracking-wider text-ink-dim">
        Sync roles to Discord
      </h2>
      <p className="text-sm text-ink-dim">
        Walks every member of this business and grants the Discord role
        matching their rank (owner / manager / employee). Removes any
        wrong-rank base role they happen to hold. Custom roles are left
        alone. Owner-only.
      </p>
      {result && result.ok && (
        <div
          role="status"
          className="rounded-md border border-ok/40 bg-ok/10 px-3 py-2 text-sm text-ok"
        >
          Added {result.data.added}, removed {result.data.removed}, skipped{' '}
          {result.data.skipped.length} members.
          {result.data.skipped.length > 0 && (
            <span className="block mt-1 text-xs text-ink-dim font-mono break-all">
              Skipped: {result.data.skipped.join(', ')}
            </span>
          )}
        </div>
      )}
      {result && !result.ok && (
        <div
          role="alert"
          className="rounded-md border border-err/40 bg-err/10 px-3 py-2 text-sm text-err"
        >
          {result.error}
        </div>
      )}
      <ServerForm
        action={`/api/otter/businesses/${slug}/sync-roles`}
        method="POST"
        confirm="This will adjust Discord roles for all members of this business. Proceed?"
        onSuccess={(data) => {
          if (
            data &&
            typeof data === 'object' &&
            (data as { ok?: unknown }).ok === true
          ) {
            const d = (data as { data: { added: number; removed: number; skipped: string[] } }).data
            setResult({ ok: true, data: d })
          } else if (data && typeof data === 'object') {
            const err = (data as { error?: unknown }).error
            setResult({
              ok: false,
              error: typeof err === 'string' ? err : 'unknown-error',
            })
          } else {
            setResult({ ok: false, error: 'bad-reply' })
          }
        }}
        className="flex justify-start"
      >
        <button
          type="submit"
          className="rounded-lg border border-accent/40 bg-accent/15 hover:bg-accent/25 px-4 py-2 text-sm text-accent font-medium"
        >
          Sync roles to Discord
        </button>
      </ServerForm>
    </section>
  )
}

export function RoleMappingsCard({
  slug,
  mappings,
  canEdit,
}: {
  slug: string
  mappings: Mapping[]
  canEdit: boolean
}): React.JSX.Element {
  const sorted = [...mappings].sort((a, b) => {
    const r = compareRank(a.rank, b.rank)
    if (r !== 0) return r
    return (a.roleName ?? '').localeCompare(b.roleName ?? '')
  })

  return (
    <section className="rounded-2xl border border-line bg-bg-card p-5 flex flex-col gap-3">
      <h2 className="text-xs uppercase tracking-wider text-ink-dim">
        Role mappings <span className="text-ink">({mappings.length})</span>
      </h2>
      {canEdit && (
        <details className="rounded-lg border border-line bg-bg-card2 p-3">
          <summary className="text-sm text-ink cursor-pointer select-none">
            Add or update mapping
          </summary>
          <div className="pt-3">
            <AddMappingForm slug={slug} />
          </div>
        </details>
      )}
      {sorted.length === 0 ? (
        <p className="text-ink-dim text-sm">
          No Discord roles mapped to ranks yet.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-ink-dim">
              <tr>
                <th className="text-left font-normal py-2 pr-3">Role</th>
                <th className="text-left font-normal py-2 pr-3">Rank</th>
                <th className="text-left font-normal py-2 pr-3">
                  Min to assign
                </th>
                <th className="text-left font-normal py-2 pr-3">Auto-grant</th>
                <th className="text-left font-normal py-2 pr-3">Base</th>
                <th className="text-left font-normal py-2 pr-3">Role ID</th>
                {canEdit && (
                  <th className="text-right font-normal py-2 pr-3">Actions</th>
                )}
              </tr>
            </thead>
            <tbody>
              {sorted.map((m) => (
                <MappingRowView
                  key={m.id}
                  slug={slug}
                  mapping={m}
                  canEdit={canEdit}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

'use client'

/**
 * `<OcStockAccessCard>` — owner-only editor for who can see and who can
 * edit the OC Stock board on the panel.
 *
 * Two rules, same shape (see `@/lib/otter/ocStockAccess` for the model and
 * the persisted JSON):
 *   - a minimum OC business rank (`anyone` → every signed-in panel user);
 *   - plus an OR-ed allowlist of Discord roles, for people who should be
 *     able to act without being promoted to manager.
 *
 * Roles come from `/api/otter/meta/roles` (60 s server cache). When that
 * fetch fails — bot offline, RPC unconfigured — we fall back to a plain
 * comma-separated snowflake input so the form still works in degraded
 * mode, exactly like `<RolePicker>` does.
 *
 * Both rules submit together as one PUT: a permissions blob is replaced
 * wholesale, never patched, so what you see in the form is exactly what
 * ends up stored. `router.refresh()` on success so the page re-renders
 * with the saved config (and with the caller's own capabilities
 * re-evaluated — an owner can lock everyone else out but never themselves).
 */
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ServerForm } from '@/lib/forms/ServerForm'
import type { MinRank, OcStockAccessConfig } from '@/lib/otter/ocStockAccess'

type Role = {
  id: string
  name: string
  color: number
  position: number
  managed: boolean
}

const RANK_OPTIONS: Array<{ value: MinRank; label: string; hint: string }> = [
  { value: 'anyone', label: 'Anyone signed in', hint: 'Every logged-in panel user' },
  { value: 'employee', label: 'OC employees and up', hint: 'Employee, manager or owner' },
  { value: 'manager', label: 'OC managers and up', hint: 'Manager or owner' },
  { value: 'owner', label: 'OC owners only', hint: 'Business owners only' },
]

const inputCls =
  'w-full rounded-md border border-line bg-bg-card2 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-accent'

function colorHex(c: number): string {
  if (!c) return '#666'
  return `#${c.toString(16).padStart(6, '0')}`
}

function RuleEditor({
  title,
  description,
  fieldPrefix,
  rank,
  onRank,
  roleIds,
  onToggleRole,
  roles,
  rolesError,
  onRawRoleIds,
}: {
  title: string
  description: string
  fieldPrefix: 'view' | 'edit'
  rank: MinRank
  onRank: (v: MinRank) => void
  roleIds: string[]
  onToggleRole: (id: string) => void
  roles: Role[] | null
  rolesError: string | null
  onRawRoleIds: (csv: string) => void
}): React.JSX.Element {
  const selectId = `${fieldPrefix}-min-rank`
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line bg-bg-card2/30 p-4">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        <p className="text-xs text-ink-dim">{description}</p>
      </div>

      <label className="flex flex-col gap-1 text-xs text-ink-dim" htmlFor={selectId}>
        Minimum rank
        <select
          id={selectId}
          name={`${fieldPrefix}MinRank`}
          value={rank}
          onChange={(e) => onRank(e.target.value as MinRank)}
          className={inputCls}
        >
          {RANK_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label} — {o.hint}
            </option>
          ))}
        </select>
      </label>

      {/* The array is flattened to CSV because <ServerForm> serialises
          FormData to a flat JSON object; the route accepts either. */}
      <input type="hidden" name={`${fieldPrefix}RoleIds`} value={roleIds.join(',')} />

      <fieldset className="flex flex-col gap-2">
        <legend className="text-xs text-ink-dim">
          Also allow these Discord roles{' '}
          <span className="opacity-70">({roleIds.length} selected)</span>
        </legend>

        {rolesError ? (
          <div className="flex flex-col gap-1">
            <p className="rounded border border-warn/40 bg-warn/10 px-2 py-1 text-[11px] text-warn">
              Couldn&apos;t load the role list ({rolesError}). Enter role IDs
              manually, comma-separated.
            </p>
            <input
              className={inputCls}
              defaultValue={roleIds.join(',')}
              onChange={(e) => onRawRoleIds(e.target.value)}
              placeholder="123456789012345678, 234567890123456789"
              aria-label={`${title} — role IDs`}
            />
          </div>
        ) : roles === null ? (
          <p className="text-xs text-ink-dim">Loading roles…</p>
        ) : (
          <div className="max-h-56 overflow-y-auto rounded-lg border border-line divide-y divide-line/60">
            {roles.map((r) => (
              <label
                key={r.id}
                className="flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-bg-card2/60 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={roleIds.includes(r.id)}
                  onChange={() => onToggleRole(r.id)}
                />
                <span
                  aria-hidden
                  className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: colorHex(r.color) }}
                />
                <span className="truncate">{r.name}</span>
              </label>
            ))}
            {roles.length === 0 && (
              <p className="px-2 py-1.5 text-xs text-ink-dim">No roles found.</p>
            )}
          </div>
        )}
      </fieldset>
    </div>
  )
}

export function OcStockAccessCard({
  config,
}: {
  config: OcStockAccessConfig
}): React.JSX.Element {
  const router = useRouter()
  const [viewRank, setViewRank] = useState<MinRank>(config.view.minRank)
  const [editRank, setEditRank] = useState<MinRank>(config.edit.minRank)
  const [viewRoles, setViewRoles] = useState<string[]>(config.view.roleIds)
  const [editRoles, setEditRoles] = useState<string[]>(config.edit.roleIds)
  const [roles, setRoles] = useState<Role[] | null>(null)
  const [rolesError, setRolesError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch('/api/otter/meta/roles', { credentials: 'same-origin' })
      .then((r) => r.json() as Promise<{ roles?: Role[]; error?: string }>)
      .then((body) => {
        if (cancelled) return
        if (body.error) {
          setRolesError(body.error)
          return
        }
        // Drop @everyone (name '@everyone') and bot-managed integration
        // roles — neither is assignable as a staff allowlist entry.
        setRoles((body.roles ?? []).filter((r) => r.name !== '@everyone' && !r.managed))
      })
      .catch((err: unknown) => {
        if (!cancelled) setRolesError(err instanceof Error ? err.message : 'network error')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const toggle = (list: string[], setList: (v: string[]) => void) => (id: string) => {
    setSaved(false)
    setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id])
  }

  const parseCsv = (setList: (v: string[]) => void) => (csv: string) => {
    setSaved(false)
    setList(csv.split(',').map((s) => s.trim()).filter(Boolean))
  }

  const summary = useMemo(() => {
    const label = (r: MinRank) => RANK_OPTIONS.find((o) => o.value === r)?.label ?? r
    return `See: ${label(viewRank)}${viewRoles.length ? ` + ${viewRoles.length} role(s)` : ''} · Edit: ${label(editRank)}${editRoles.length ? ` + ${editRoles.length} role(s)` : ''}`
  }, [viewRank, editRank, viewRoles, editRoles])

  return (
    <section className="rounded-2xl border border-line bg-bg-card p-4 flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold text-ink">Access</h2>
        <p className="text-xs text-ink-dim">
          Controls this page and the OC stock API. Bot owners and OC business
          owners always keep full access, so you can&apos;t lock yourself out.
          Discord&apos;s own <code className="font-mono">/oc</code> command is
          unaffected — it stays manager+ for editing.
        </p>
        <p className="text-xs text-ink-dim">{summary}</p>
      </header>

      <ServerForm
        action="/api/otter/oc-stock/access"
        method="PUT"
        onSuccess={() => {
          setSaved(true)
          router.refresh()
        }}
        className="flex flex-col gap-4"
      >
        <div className="grid gap-4 md:grid-cols-2">
          <RuleEditor
            title="Who can see the board"
            description="Read-only access to the stock list on this page and via the API."
            fieldPrefix="view"
            rank={viewRank}
            onRank={(v) => {
              setSaved(false)
              setViewRank(v)
            }}
            roleIds={viewRoles}
            onToggleRole={toggle(viewRoles, setViewRoles)}
            roles={roles}
            rolesError={rolesError}
            onRawRoleIds={parseCsv(setViewRoles)}
          />
          <RuleEditor
            title="Who can edit the board"
            description="Add, rename, re-status, link and delete items. Implies see."
            fieldPrefix="edit"
            rank={editRank}
            onRank={(v) => {
              setSaved(false)
              setEditRank(v)
            }}
            roleIds={editRoles}
            onToggleRole={toggle(editRoles, setEditRoles)}
            roles={roles}
            rolesError={rolesError}
            onRawRoleIds={parseCsv(setEditRoles)}
          />
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            className="rounded-lg border border-accent/40 bg-accent/10 px-3 py-1.5 text-sm text-accent hover:bg-accent/20"
          >
            Save access rules
          </button>
          {saved && (
            <span role="status" className="text-xs text-emerald-300">
              Saved.
            </span>
          )}
        </div>
      </ServerForm>
    </section>
  )
}

'use client'

/**
 * Sudo write controls for /squishy/roles.
 *
 * All write surfaces here go through `<ServerForm>` (`@/lib/forms/ServerForm`),
 * which:
 *   - injects the double-submit CSRF token on every POST/PUT/PATCH/DELETE,
 *   - swaps the body to JSON when a hidden `<input name="_format" value="json">`
 *     is present (every form here opts in),
 *   - disables the fieldset while submitting and surfaces 4xx `error` bodies
 *     in a red banner above the form.
 *
 * The page is a server component, so after every successful write we want
 * to re-fetch the table data. ServerForm doesn't auto-`router.refresh()`
 * (its design hands navigation to the caller), so each form here passes an
 * `onSuccess={() => router.refresh()}` callback.
 *
 * Exports:
 *   - `<AddAutoJoinForm />`      — top-of-tab add form on the join tab.
 *   - `<RemoveAutoJoinButton />` — per-row remove.
 *   - `<AddColorRoleForm />`     — top-of-tab add form on the color tab.
 *   - `<EditColorRoleForm />`    — collapsible per-card label/sortOrder editor.
 *   - `<RemoveColorRoleButton />`— per-card remove.
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
  'inline-flex items-center px-2 py-1 text-xs rounded-md border border-err/40 bg-err/10 text-err hover:bg-err/20 transition-colors'
const btnGhost =
  'text-[11px] text-ink-dim hover:text-ink underline-offset-2 hover:underline self-start'

export function AddAutoJoinForm() {
  const router = useRouter()
  return (
    <div className="rounded-xl border border-line bg-bg-card p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium">Add auto-join role</h3>
        <span className="text-[11px] text-ink-dim">sudo · audit-logged</span>
      </div>
      <ServerForm
        action="/api/squishy/auto-join-roles"
        method="POST"
        onSuccess={() => router.refresh()}
        className="flex flex-col gap-2"
      >
        <input type="hidden" name="_format" value="json" />
        <label className={labelCls} htmlFor="ajr-roleId">
          Role ID
        </label>
        <input
          id="ajr-roleId"
          name="roleId"
          type="text"
          required
          inputMode="numeric"
          pattern="\d{15,25}"
          placeholder="e.g. 123456789012345678"
          className={inputCls}
        />
        <p className="text-[11px] text-ink-dim">
          Discord role snowflake (15–25 digits). The bot applies this role on
          every new join while{' '}
          <code className="font-mono">feature.auto_role_on_join</code> is on.
        </p>
        <div>
          <button type="submit" className={btnPrimary}>
            Add role
          </button>
        </div>
      </ServerForm>
    </div>
  )
}

export function RemoveAutoJoinButton({ roleId }: { roleId: string }) {
  const router = useRouter()
  return (
    <ServerForm
      action={`/api/squishy/auto-join-roles/${roleId}`}
      method="DELETE"
      onSuccess={() => router.refresh()}
      className="inline"
    >
      <button
        type="submit"
        className={btnDanger}
        onClick={(e) => {
          if (!window.confirm(`Remove auto-join role ${roleId}?`)) {
            e.preventDefault()
          }
        }}
      >
        Remove
      </button>
    </ServerForm>
  )
}

export function AddColorRoleForm() {
  const router = useRouter()
  return (
    <div className="rounded-xl border border-line bg-bg-card p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium">Add color role</h3>
        <span className="text-[11px] text-ink-dim">sudo · audit-logged</span>
      </div>
      <ServerForm
        action="/api/squishy/color-roles"
        method="POST"
        onSuccess={() => router.refresh()}
        className="flex flex-col gap-2"
      >
        <input type="hidden" name="_format" value="json" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="flex flex-col gap-1">
            <label className={labelCls} htmlFor="cr-roleId">
              Role ID
            </label>
            <input
              id="cr-roleId"
              name="roleId"
              type="text"
              required
              inputMode="numeric"
              pattern="\d{15,25}"
              placeholder="123456789012345678"
              className={inputCls}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className={labelCls} htmlFor="cr-label">
              Label (optional)
            </label>
            <input
              id="cr-label"
              name="label"
              type="text"
              maxLength={100}
              placeholder="e.g. Cherry"
              className={inputCls}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className={labelCls} htmlFor="cr-sortOrder">
              Sort order (optional)
            </label>
            <input
              id="cr-sortOrder"
              name="sortOrder"
              type="number"
              step={1}
              placeholder="0"
              className={inputCls}
            />
          </div>
        </div>
        <p className="text-[11px] text-ink-dim">
          Re-posting an existing role ID updates label / sort order instead of
          409&apos;ing. Hex color lives on the Discord role itself — not stored
          here.
        </p>
        <div>
          <button type="submit" className={btnPrimary}>
            Add color
          </button>
        </div>
      </ServerForm>
    </div>
  )
}

export function EditColorRoleForm({
  roleId,
  label,
  sortOrder,
}: {
  roleId: string
  label: string
  sortOrder: number
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
        Edit label
      </button>
    )
  }
  return (
    <div className="flex flex-col gap-2 mt-1 rounded-md border border-line bg-bg-card2 p-2">
      <ServerForm
        action={`/api/squishy/color-roles/${roleId}`}
        method="PATCH"
        onSuccess={() => {
          setOpen(false)
          router.refresh()
        }}
        className="flex flex-col gap-2"
      >
        <input type="hidden" name="_format" value="json" />
        <div className="flex flex-col gap-1">
          <label className={labelCls} htmlFor={`cr-edit-label-${roleId}`}>
            Label
          </label>
          <input
            id={`cr-edit-label-${roleId}`}
            name="label"
            type="text"
            defaultValue={label}
            maxLength={100}
            className={inputCls}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className={labelCls} htmlFor={`cr-edit-sort-${roleId}`}>
            Sort order
          </label>
          <input
            id={`cr-edit-sort-${roleId}`}
            name="sortOrder"
            type="number"
            step={1}
            defaultValue={sortOrder}
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

export function RemoveColorRoleButton({ roleId }: { roleId: string }) {
  const router = useRouter()
  return (
    <ServerForm
      action={`/api/squishy/color-roles/${roleId}`}
      method="DELETE"
      onSuccess={() => router.refresh()}
      className="inline"
    >
      <button
        type="submit"
        className={btnDanger}
        onClick={(e) => {
          if (!window.confirm(`Remove color role ${roleId}?`)) {
            e.preventDefault()
          }
        }}
      >
        Remove
      </button>
    </ServerForm>
  )
}

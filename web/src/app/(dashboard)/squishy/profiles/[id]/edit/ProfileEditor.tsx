'use client'

/**
 * Profile editor client component.
 *
 * Wraps `<ServerForm method="PATCH">` (JSON default) and renders the field
 * set based on `mode`. On success we router.refresh() AND push back to the
 * read-only detail page so the user sees their changes immediately on a
 * fresh server render. Cancel just navigates back without submitting.
 *
 * The birthday row groups month / day / year inputs side-by-side with the
 * two visibility toggles inline. We DO submit all three birthday parts on
 * every save so partial clears (e.g. "remove just the year") work via
 * empty strings — the API coerces empty-string → null.
 *
 * Checkboxes are tricky: a FormData entry for an unchecked box is absent
 * entirely. <ServerForm> JSON serializes only the entries it sees, so an
 * unchecked toggle would never be sent — meaning we couldn't ever flip a
 * pings_enabled=true row back to false from the form. To work around this
 * we render a hidden 'false' input BEFORE each checkbox with the same name;
 * if the checkbox is unchecked, only the 'false' input reaches FormData,
 * and if it's checked the checkbox's 'true' value overrides (FormData takes
 * the last entry for a given key). This is the classic "always-send-a-value"
 * pattern.
 */
import { useRouter } from 'next/navigation'
import { useCallback } from 'react'
import { ServerForm } from '@/lib/forms/ServerForm'

export type EditableProfile = {
  realName: string | null
  displayName: string | null
  birthdayMonth: number | null
  birthdayDay: number | null
  birthdayYear: number | null
  birthdayPingsEnabled: boolean
  birthdayYearVisible: boolean
  staffCategory: string | null
  department: string | null
  tier: string | null
  leadershipTitle: string | null
}

export type ProfileEditorProps = {
  id: string
  mode: 'sudo' | 'self'
  profile: EditableProfile | null
}

const inputCls =
  'w-full rounded-md border border-line bg-bg-card2 px-3 py-2 text-sm text-ink placeholder:text-ink-dim/60 focus:outline-none focus:ring-1 focus:ring-accent'
const labelCls = 'text-xs uppercase tracking-wider text-ink-dim'
const fieldCls = 'flex flex-col gap-1.5'

function TextField({
  name,
  label,
  defaultValue,
  maxLength,
  placeholder,
}: {
  name: string
  label: string
  defaultValue: string
  maxLength: number
  placeholder?: string
}) {
  return (
    <div className={fieldCls}>
      <label className={labelCls} htmlFor={`pf-${name}`}>
        {label}
      </label>
      <input
        id={`pf-${name}`}
        name={name}
        type="text"
        defaultValue={defaultValue}
        maxLength={maxLength}
        placeholder={placeholder}
        className={inputCls}
      />
      <div className="text-[11px] text-ink-dim/70">
        Leave blank to clear. Max {maxLength} chars.
      </div>
    </div>
  )
}

function NumberField({
  name,
  label,
  defaultValue,
  min,
  max,
  width = 'w-24',
}: {
  name: string
  label: string
  defaultValue: number | null
  min: number
  max: number
  width?: string
}) {
  return (
    <div className={`${fieldCls} ${width}`}>
      <label className={labelCls} htmlFor={`pf-${name}`}>
        {label}
      </label>
      <input
        id={`pf-${name}`}
        name={name}
        type="number"
        defaultValue={defaultValue ?? ''}
        min={min}
        max={max}
        inputMode="numeric"
        className={inputCls}
      />
    </div>
  )
}

function BoolToggle({
  name,
  label,
  defaultChecked,
  hint,
}: {
  name: string
  label: string
  defaultChecked: boolean
  hint?: string
}) {
  return (
    <label className="flex items-start gap-2 cursor-pointer select-none">
      {/*
        Hidden 'false' sentinel BEFORE the real checkbox — guarantees a value
        always reaches the API even when the box is unchecked. The checkbox
        below shares the same `name`, so when checked it overrides this
        entry in the FormData snapshot (FormData keeps last write for a
        given key in <ServerForm>'s JSON mode).
      */}
      <input type="hidden" name={name} value="false" />
      <input
        type="checkbox"
        name={name}
        value="true"
        defaultChecked={defaultChecked}
        className="mt-0.5 h-4 w-4 rounded border-line bg-bg-card2 text-accent focus:ring-1 focus:ring-accent"
      />
      <span className="flex flex-col gap-0.5">
        <span className="text-sm text-ink">{label}</span>
        {hint && <span className="text-[11px] text-ink-dim/70">{hint}</span>}
      </span>
    </label>
  )
}

export function ProfileEditor({ id, mode, profile }: ProfileEditorProps) {
  const router = useRouter()

  const detailUrl = `/squishy/profiles/${id}`

  const onSuccess = useCallback(() => {
    // Refresh first so the read-only detail page re-fetches when we land
    // there (saves a flash of stale data); push handles the actual nav.
    router.refresh()
    router.push(detailUrl)
  }, [router, detailUrl])

  const onCancel = useCallback(() => {
    router.push(detailUrl)
  }, [router, detailUrl])

  // Empty-state defaults — when there's no row yet, the form behaves as a
  // "create new" form. The API upserts on first save.
  const p: EditableProfile = profile ?? {
    realName: null,
    displayName: null,
    birthdayMonth: null,
    birthdayDay: null,
    birthdayYear: null,
    birthdayPingsEnabled: true,
    birthdayYearVisible: false,
    staffCategory: null,
    department: null,
    tier: null,
    leadershipTitle: null,
  }

  return (
    <ServerForm
      action={`/api/squishy/profiles/${id}`}
      method="PATCH"
      onSuccess={onSuccess}
      className="flex flex-col gap-6"
    >
      {/* Name fields */}
      <section className="rounded-2xl border border-line bg-bg-card p-6 flex flex-col gap-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-dim">
          Names
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <TextField
            name="displayName"
            label="Display name"
            defaultValue={p.displayName ?? ''}
            maxLength={80}
            placeholder="What people call you"
          />
          <TextField
            name="realName"
            label="Real name"
            defaultValue={p.realName ?? ''}
            maxLength={80}
            placeholder="Optional"
          />
        </div>
      </section>

      {/* Birthday */}
      <section className="rounded-2xl border border-line bg-bg-card p-6 flex flex-col gap-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-dim">
          Birthday
        </h2>
        <div className="flex flex-wrap items-end gap-4">
          <NumberField
            name="birthdayMonth"
            label="Month"
            defaultValue={p.birthdayMonth}
            min={1}
            max={12}
          />
          <NumberField
            name="birthdayDay"
            label="Day"
            defaultValue={p.birthdayDay}
            min={1}
            max={31}
          />
          <NumberField
            name="birthdayYear"
            label="Year"
            defaultValue={p.birthdayYear}
            min={1900}
            max={9999}
            width="w-28"
          />
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:gap-6">
          <BoolToggle
            name="birthdayPingsEnabled"
            label="Birthday pings"
            defaultChecked={p.birthdayPingsEnabled}
            hint="Squishy posts a happy-birthday message on your day."
          />
          <BoolToggle
            name="birthdayYearVisible"
            label="Show year publicly"
            defaultChecked={p.birthdayYearVisible}
            hint="When off, only month/day are shown to other users."
          />
        </div>
        <p className="text-[11px] text-ink-dim/70">
          Leave any number blank to clear. The bot validates day-vs-month at
          render time, but the panel only enforces simple range checks here.
        </p>
      </section>

      {/* Actions */}
      <div className="flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-line bg-transparent px-4 py-2 text-sm text-ink-dim hover:text-ink hover:bg-bg-card2"
        >
          Cancel
        </button>
        <button
          type="submit"
          className="rounded-md border border-accent/40 bg-accent/20 px-4 py-2 text-sm text-ink hover:bg-accent/30"
        >
          Save profile
        </button>
      </div>
    </ServerForm>
  )
}

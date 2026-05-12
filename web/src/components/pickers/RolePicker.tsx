'use client'

/**
 * `<RolePicker>` — styled dropdown of Discord roles in the configured guild.
 *
 * Fetches roles from `/api/squishy/meta/roles` once on mount (route caches
 * upstream for 60s so re-mounts of this component on the same page are
 * effectively free). Renders a native `<select>` with options grouped by
 * `hoisted` (sidebar-grouped roles separated from regular ones) and a
 * color swatch beside each option's label.
 *
 * Falls back to a plain snowflake `<input>` plus an error banner whenever
 * the fetch fails (bot offline, RPC misconfigured, etc.) so the form keeps
 * working in degraded mode. The hidden input name matches the picker's
 * `name` prop so form submission contracts are unchanged.
 *
 * Props:
 *  - `name`        — form field name (required).
 *  - `value`       — controlled current value.
 *  - `defaultValue`— uncontrolled initial value.
 *  - `onChange`    — fires with the new role ID (or '' for "none").
 *  - `allowNone`   — if true, prepends a "— None —" option that submits as ''.
 *  - `required`    — passed through to the `<select>`/`<input>`.
 */
import { useEffect, useMemo, useState } from 'react'

const inputCls =
  'w-full rounded-md border border-line bg-bg-card2 px-2 py-1.5 text-sm placeholder:text-ink-dim/50 focus:outline-none focus:ring-1 focus:ring-accent'
const errCls =
  'mt-1 rounded border border-warn/40 bg-warn/10 px-2 py-1 text-[11px] text-warn'

type Role = {
  id: string
  name: string
  color: number
  position: number
  managed: boolean
  hoisted: boolean
  mentionable: boolean
}

function colorHex(c: number): string {
  // Discord role color is a 24-bit int; 0 means "no color" — render a
  // muted neutral so the swatch column doesn't disappear.
  if (!c) return '#666'
  return `#${c.toString(16).padStart(6, '0')}`
}

export function RolePicker({
  name,
  value,
  defaultValue,
  onChange,
  allowNone,
  required,
  id,
}: {
  name: string
  value?: string
  defaultValue?: string
  onChange?: (value: string) => void
  allowNone?: boolean
  required?: boolean
  id?: string
}) {
  const [roles, setRoles] = useState<Role[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    fetch('/api/squishy/meta/roles', { credentials: 'same-origin' })
      .then(r => r.json())
      .then((body: { roles?: Role[]; error?: string }) => {
        if (!alive) return
        if (body.error) {
          setError(body.error)
          setRoles([])
        } else {
          setRoles(Array.isArray(body.roles) ? body.roles : [])
        }
      })
      .catch(e => {
        if (!alive) return
        setError(e instanceof Error ? e.message : 'fetch-failed')
        setRoles([])
      })
    return () => { alive = false }
  }, [])

  // Group hoisted before non-hoisted so the dropdown matches Discord's
  // sidebar grouping. Within a group, position-desc order is preserved
  // from the API (server sorts it that way).
  const { hoisted, regular } = useMemo(() => {
    const h: Role[] = []
    const r: Role[] = []
    for (const role of roles ?? []) {
      // @everyone never makes sense to pick — managed bot roles usually don't either,
      // but we leave them in for completeness (a sudo might want to ping a bot role).
      if (role.name === '@everyone') continue
      if (role.hoisted) h.push(role)
      else r.push(role)
    }
    return { hoisted: h, regular: r }
  }, [roles])

  // Loading + error: render an input fallback so the form is still usable.
  // The hidden `name` is identical to the picker's so submission contract
  // doesn't change in degraded mode.
  if (error || (roles && roles.length === 0 && !error)) {
    return (
      <div className="flex flex-col gap-1">
        <input
          id={id}
          type="text"
          name={name}
          defaultValue={defaultValue}
          required={required}
          inputMode="numeric"
          pattern="\d{15,25}"
          placeholder="role snowflake (15-25 digits)"
          className={inputCls}
          onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        />
        {error && (
          <div className={errCls} role="alert">
            Couldn&apos;t load roles ({error}). Paste the role ID instead.
          </div>
        )}
      </div>
    )
  }

  if (!roles) {
    return (
      <select
        id={id}
        name={name}
        disabled
        className={inputCls}
        aria-label="Loading roles…"
      >
        <option>Loading roles…</option>
      </select>
    )
  }

  return (
    <select
      id={id}
      name={name}
      value={value}
      defaultValue={defaultValue}
      required={required}
      onChange={onChange ? (e) => onChange(e.target.value) : undefined}
      className={inputCls}
    >
      {allowNone && <option value="">— None —</option>}
      {hoisted.length > 0 && (
        <optgroup label="Hoisted">
          {hoisted.map(r => (
            <option key={r.id} value={r.id}>
              {`● `}{r.name}
              {/* color swatch as a leading bullet — browsers don't allow real
                  styling on <option> across all platforms, so we inline a
                  unicode bullet whose color we can't quite force. Renders
                  cleanly enough for the role-picker context. */}
            </option>
          ))}
        </optgroup>
      )}
      <optgroup label={hoisted.length > 0 ? 'Other' : 'Roles'}>
        {regular.map(r => (
          <option key={r.id} value={r.id} style={{ color: colorHex(r.color) }}>
            {r.name}
          </option>
        ))}
      </optgroup>
    </select>
  )
}

'use client'
/**
 * Switch — an accessible toggle built on a real checkbox so it submits inside
 * a plain <form> / <ServerForm> with `name`/`value` and participates in
 * `fieldset[disabled]` the same way native inputs do. Uncontrolled by
 * default (`defaultChecked`); pass `checked`+`onCheckedChange` to control it.
 */
import { useId } from 'react'
import { cn } from './cn'

export function Switch({
  name,
  value = 'true',
  checked,
  defaultChecked,
  onCheckedChange,
  disabled,
  label,
  className,
  id,
}: {
  name?: string
  value?: string
  checked?: boolean
  defaultChecked?: boolean
  onCheckedChange?: (checked: boolean) => void
  disabled?: boolean
  label?: string
  className?: string
  id?: string
}) {
  const autoId = useId()
  const inputId = id ?? autoId
  return (
    <label
      htmlFor={inputId}
      className={cn('inline-flex items-center gap-2.5 cursor-pointer select-none', disabled && 'opacity-50 cursor-not-allowed', className)}
    >
      <span className="relative inline-block">
        <input
          id={inputId}
          type="checkbox"
          name={name}
          value={value}
          checked={checked}
          defaultChecked={defaultChecked}
          disabled={disabled}
          onChange={(e) => onCheckedChange?.(e.currentTarget.checked)}
          className="peer sr-only"
        />
        <span className="block h-6 w-11 rounded-full bg-bg-hover border border-line transition-colors peer-checked:bg-accent peer-checked:border-accent peer-focus-visible:ring-2 peer-focus-visible:ring-accent peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-bg" />
        <span className="pointer-events-none absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5" />
      </span>
      {label && <span className="text-sm text-ink">{label}</span>}
    </label>
  )
}

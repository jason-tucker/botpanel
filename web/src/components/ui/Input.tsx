/**
 * Form input primitives — Input, Textarea, Select, Label, Field, Hint.
 *
 * These pair with the existing <ServerForm> (which owns CSRF + submit
 * plumbing): drop these inside a ServerForm and they post like any native
 * control. Styling is unified so every form across the panel reads the same.
 * Server-safe (no hooks).
 */
import type {
  InputHTMLAttributes,
  TextareaHTMLAttributes,
  SelectHTMLAttributes,
  LabelHTMLAttributes,
  HTMLAttributes,
} from 'react'
import { forwardRef } from 'react'
import { cn } from './cn'

const FIELD_BASE =
  'w-full rounded-xl border border-line bg-bg-app/60 px-3 py-2 text-sm text-ink placeholder:text-ink-faint ' +
  'transition-colors focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent ' +
  'disabled:opacity-50 disabled:cursor-not-allowed'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...rest }, ref) {
    return <input ref={ref} className={cn(FIELD_BASE, 'h-10', className)} {...rest} />
  },
)

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...rest }, ref) {
    return <textarea ref={ref} className={cn(FIELD_BASE, 'min-h-[88px] resize-y leading-relaxed', className)} {...rest} />
  },
)

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...rest }, ref) {
    return (
      <select ref={ref} className={cn(FIELD_BASE, 'h-10 pr-8 appearance-none cursor-pointer', className)} {...rest}>
        {children}
      </select>
    )
  },
)

export function Label({ className, ...rest }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn('text-sm font-medium text-ink', className)} {...rest} />
}

export function Hint({ className, ...rest }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-xs text-ink-dim', className)} {...rest} />
}

/**
 * Field — a labelled control group with optional hint + error. Wrap any of
 * the inputs above:
 *   <Field label="Channel" hint="Where the post lands">
 *     <Select name="channel">…</Select>
 *   </Field>
 */
export function Field({
  label,
  hint,
  error,
  htmlFor,
  required,
  className,
  children,
}: {
  label?: string
  hint?: string
  error?: string | null
  htmlFor?: string
  required?: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label && (
        <Label htmlFor={htmlFor}>
          {label}
          {required && <span className="ml-0.5 text-err">*</span>}
        </Label>
      )}
      {children}
      {error ? <p className="text-xs text-err">{error}</p> : hint ? <Hint>{hint}</Hint> : null}
    </div>
  )
}

'use client'
/**
 * Button — the canonical action control for the panel.
 *
 * Variants map to the new palette tokens (see tailwind.config.ts). `buttonClasses`
 * is exported separately so a `next/link` can borrow the exact same styling
 * without us re-implementing an "as link" slot:
 *
 *   <Link href="/x" className={buttonClasses({ variant: 'secondary' })}>Go</Link>
 *
 * The `loading` prop swaps the leading icon for a Spinner and disables the
 * button so async submits can't double-fire.
 */
import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from './cn'
import { Icon, Spinner, type IconName } from './icons'

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'ghost'
  | 'outline'
  | 'danger'
  | 'subtle'
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon'

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-accent text-white shadow-pop hover:bg-accent-bright active:translate-y-px',
  secondary:
    'bg-bg-raised text-ink border border-line hover:bg-bg-hover hover:border-line-bright',
  ghost: 'bg-transparent text-ink-dim hover:bg-bg-hover hover:text-ink',
  outline:
    'bg-transparent text-ink border border-line hover:border-accent hover:text-ink',
  danger: 'bg-err text-white shadow-pop hover:brightness-110 active:translate-y-px',
  subtle: 'bg-accent-soft text-accent hover:bg-accent/20',
}

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5 rounded-lg',
  md: 'h-10 px-4 text-sm gap-2 rounded-xl',
  lg: 'h-12 px-5 text-base gap-2 rounded-xl',
  icon: 'h-9 w-9 rounded-lg justify-center',
}

export function buttonClasses(opts?: {
  variant?: ButtonVariant
  size?: ButtonSize
  className?: string
}): string {
  const { variant = 'primary', size = 'md', className } = opts ?? {}
  return cn(
    'inline-flex items-center justify-center font-semibold whitespace-nowrap select-none',
    'transition-all duration-150 ease-out',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
    'disabled:opacity-50 disabled:pointer-events-none',
    VARIANTS[variant],
    SIZES[size],
    className,
  )
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Leading icon name (hidden while `loading`). */
  icon?: IconName
  /** Trailing icon name. */
  iconAfter?: IconName
  loading?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', icon, iconAfter, loading, className, children, disabled, type, ...rest },
  ref,
) {
  const iconSize = size === 'lg' ? 18 : 16
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      disabled={disabled || loading}
      className={buttonClasses({ variant, size, className })}
      {...rest}
    >
      {loading ? (
        <Spinner size={iconSize} />
      ) : icon ? (
        <Icon name={icon} size={iconSize} />
      ) : null}
      {children}
      {iconAfter && !loading ? <Icon name={iconAfter} size={iconSize} /> : null}
    </button>
  )
})

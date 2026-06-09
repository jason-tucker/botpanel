/**
 * Badge / pill — compact status + label chips.
 *
 * `tone` maps to the semantic palette. `dot` renders a leading status dot
 * (used by the bot-health pills and "online" markers). Server-safe.
 */
import type { HTMLAttributes } from 'react'
import { cn } from './cn'

export type BadgeTone =
  | 'neutral'
  | 'accent'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'

const TONES: Record<BadgeTone, string> = {
  neutral: 'border-line text-ink-dim bg-bg-raised',
  accent: 'border-accent/40 text-accent bg-accent-soft',
  success: 'border-ok/40 text-ok bg-ok/10',
  warning: 'border-warn/40 text-warn bg-warn/10',
  danger: 'border-err/40 text-err bg-err/10',
  info: 'border-info/40 text-info bg-info/10',
}

const DOT_TONES: Record<BadgeTone, string> = {
  neutral: 'bg-ink-faint',
  accent: 'bg-accent',
  success: 'bg-ok',
  warning: 'bg-warn',
  danger: 'bg-err',
  info: 'bg-info',
}

export function Badge({
  tone = 'neutral',
  dot,
  pulse,
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone; dot?: boolean; pulse?: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium',
        TONES[tone],
        className,
      )}
      {...rest}
    >
      {dot && (
        <span className="relative flex h-1.5 w-1.5">
          {pulse && (
            <span
              className={cn(
                'absolute inline-flex h-full w-full animate-ping rounded-full opacity-60',
                DOT_TONES[tone],
              )}
            />
          )}
          <span className={cn('relative inline-flex h-1.5 w-1.5 rounded-full', DOT_TONES[tone])} />
        </span>
      )}
      {children}
    </span>
  )
}

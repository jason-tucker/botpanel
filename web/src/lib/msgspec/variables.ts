/**
 * Variable + Discord-timestamp helpers shared by the editor and its live
 * preview. Substitution semantics are kept identical to the bot
 * (`src/services/msgspec/variables.ts`) so the preview is WYSIWYG:
 *
 *   {{name}}      → ctx.values[name]
 *   {{name:mod}}  → for a timestamp variable, a literal `<t:UNIX:mod>` which
 *                   the preview renderer then formats into a styled chip.
 *
 * Unknown tokens are left untouched.
 */

export type TimestampStyle = 't' | 'T' | 'd' | 'D' | 'f' | 'F' | 'R'

export const TIMESTAMP_STYLES: { style: TimestampStyle; label: string; hint: string }[] = [
  { style: 't', label: 'Short time', hint: '4:30 PM' },
  { style: 'T', label: 'Long time', hint: '4:30:00 PM' },
  { style: 'd', label: 'Short date', hint: '06/06/2026' },
  { style: 'D', label: 'Long date', hint: 'June 6, 2026' },
  { style: 'f', label: 'Short date/time', hint: 'June 6, 2026 4:30 PM' },
  { style: 'F', label: 'Long date/time', hint: 'Saturday, June 6, 2026 4:30 PM' },
  { style: 'R', label: 'Relative', hint: 'in 2 hours' },
]

/** `<t:UNIX:style>` — the literal Discord stores; viewers see it in their TZ. */
export function discordTimestamp(unixSeconds: number, style: TimestampStyle = 'f'): string {
  return `<t:${Math.floor(unixSeconds)}:${style}>`
}

/** Human approximation of how Discord renders `<t:UNIX:style>` (for preview). */
export function formatDiscordTimestamp(unixSeconds: number, style: TimestampStyle): string {
  const ms = unixSeconds * 1000
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return '(invalid time)'

  if (style === 'R') {
    const diff = ms - Date.now()
    const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
    const abs = Math.abs(diff)
    const units: [Intl.RelativeTimeFormatUnit, number][] = [
      ['year', 31536000000],
      ['month', 2592000000],
      ['day', 86400000],
      ['hour', 3600000],
      ['minute', 60000],
      ['second', 1000],
    ]
    for (const [unit, msPer] of units) {
      if (abs >= msPer || unit === 'second') {
        return rtf.format(Math.round(diff / msPer), unit)
      }
    }
  }

  const opts: Intl.DateTimeFormatOptions =
    style === 't'
      ? { hour: 'numeric', minute: '2-digit' }
      : style === 'T'
        ? { hour: 'numeric', minute: '2-digit', second: '2-digit' }
        : style === 'd'
          ? { year: 'numeric', month: '2-digit', day: '2-digit' }
          : style === 'D'
            ? { year: 'numeric', month: 'long', day: 'numeric' }
            : style === 'F'
              ? { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }
              : { year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' } // 'f'
  return new Intl.DateTimeFormat('en-US', opts).format(d)
}

/**
 * A variable the editor offers in its "insert variable" menu and substitutes
 * in the preview. `isTimestamp` vars insert `{{name:STYLE}}` and preview from
 * `sampleUnix` (overridable live, e.g. the chosen event time).
 */
export interface VariableDef {
  name: string
  label: string
  /** Preview value for plain vars. */
  sample: string
  description?: string
  isTimestamp?: boolean
  /** Preview unix-seconds for timestamp vars. */
  sampleUnix?: number
}

export interface SubstitutionContext {
  values: Record<string, string>
  timestamps?: Record<string, number>
}

const TOKEN_RE = /\{\{\s*([a-zA-Z0-9_.]+)(?::([a-zA-Z]+))?\s*\}\}/g
const VALID_STYLES = new Set<string>(['t', 'T', 'd', 'D', 'f', 'F', 'R'])

export function substitute(text: string, ctx: SubstitutionContext): string {
  if (!text) return text
  const timestamps = ctx.timestamps ?? {}
  return text.replace(TOKEN_RE, (whole, name: string, mod: string | undefined) => {
    if (name in timestamps) {
      const style = (mod && VALID_STYLES.has(mod) ? mod : 'f') as TimestampStyle
      return discordTimestamp(timestamps[name], style)
    }
    if (name in ctx.values) return ctx.values[name]
    return whole
  })
}

/** Build a preview substitution context from variable defs + live overrides. */
export function previewContext(
  vars: VariableDef[],
  timestampOverrides: Record<string, number> = {},
): SubstitutionContext {
  const values: Record<string, string> = {}
  const timestamps: Record<string, number> = {}
  for (const v of vars) {
    if (v.isTimestamp) {
      timestamps[v.name] = timestampOverrides[v.name] ?? v.sampleUnix ?? Math.floor(Date.now() / 1000)
    } else {
      values[v.name] = v.sample
    }
  }
  return { values, timestamps }
}

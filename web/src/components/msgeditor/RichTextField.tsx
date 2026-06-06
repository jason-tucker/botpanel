'use client'

/**
 * Textarea + Discord-markdown toolbar. Reused for every free-text field in the
 * editor (top-level text nodes and section lines). Provides:
 *  - formatting (bold / italic / underline / strike / code / code-block /
 *    heading / subtext / quote / bullet / link),
 *  - an "insert variable" menu (driven by the caller's VariableDef[]),
 *  - a timestamp builder that emits literal `<t:UNIX:style>` tokens.
 */
import { useRef, useState } from 'react'
import {
  TIMESTAMP_STYLES,
  discordTimestamp,
  formatDiscordTimestamp,
  type TimestampStyle,
  type VariableDef,
} from '@/lib/msgspec/variables'
import { inputCls, iconBtn, btnGhost } from './styles'

function localDatetimeToUnix(v: string): number | null {
  if (!v) return null
  const ms = new Date(v).getTime()
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null
}

function defaultLocalDatetime(): string {
  const d = new Date(Date.now() + 3 * 3600_000)
  d.setSeconds(0, 0)
  // to `YYYY-MM-DDTHH:mm` in local time
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function RichTextField({
  value,
  onChange,
  variables,
  rows = 3,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  variables: VariableDef[]
  rows?: number
  placeholder?: string
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const [tsOpen, setTsOpen] = useState(false)
  const [tsDate, setTsDate] = useState(defaultLocalDatetime())
  const [tsStyle, setTsStyle] = useState<TimestampStyle>('F')

  function apply(transform: (val: string, s: number, e: number) => { value: string; selStart: number; selEnd: number }) {
    const el = ref.current
    const s = el?.selectionStart ?? value.length
    const e = el?.selectionEnd ?? value.length
    const r = transform(value, s, e)
    onChange(r.value)
    requestAnimationFrame(() => {
      if (!el) return
      el.focus()
      el.setSelectionRange(r.selStart, r.selEnd)
    })
  }

  const wrap = (pre: string, suf = pre) =>
    apply((val, s, e) => {
      const sel = val.slice(s, e) || 'text'
      const nv = val.slice(0, s) + pre + sel + suf + val.slice(e)
      return { value: nv, selStart: s + pre.length, selEnd: s + pre.length + sel.length }
    })

  const prefixLine = (pre: string) =>
    apply((val, s) => {
      const lineStart = val.lastIndexOf('\n', s - 1) + 1
      const nv = val.slice(0, lineStart) + pre + val.slice(lineStart)
      const pos = s + pre.length
      return { value: nv, selStart: pos, selEnd: pos }
    })

  const insert = (text: string) =>
    apply((val, s, e) => {
      const nv = val.slice(0, s) + text + val.slice(e)
      const pos = s + text.length
      return { value: nv, selStart: pos, selEnd: pos }
    })

  const tsUnix = localDatetimeToUnix(tsDate)

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-1">
        <button type="button" className={iconBtn} title="Bold" onClick={() => wrap('**')}><b>B</b></button>
        <button type="button" className={iconBtn} title="Italic" onClick={() => wrap('*')}><i>I</i></button>
        <button type="button" className={iconBtn} title="Underline" onClick={() => wrap('__')}><u>U</u></button>
        <button type="button" className={iconBtn} title="Strikethrough" onClick={() => wrap('~~')}><s>S</s></button>
        <button type="button" className={iconBtn} title="Inline code" onClick={() => wrap('`')}>{'<>'}</button>
        <button type="button" className={iconBtn} title="Code block" onClick={() => wrap('```\n', '\n```')}>{'{ }'}</button>
        <span className="mx-0.5 h-4 w-px bg-line" />
        <button type="button" className={iconBtn} title="Heading" onClick={() => prefixLine('## ')}>H</button>
        <button type="button" className={iconBtn} title="Subtext" onClick={() => prefixLine('-# ')}>﹣</button>
        <button type="button" className={iconBtn} title="Quote" onClick={() => prefixLine('> ')}>❝</button>
        <button type="button" className={iconBtn} title="Bullet list" onClick={() => prefixLine('- ')}>•</button>
        <button type="button" className={iconBtn} title="Link" onClick={() => insert('[text](https://)')}>🔗</button>
        <span className="mx-0.5 h-4 w-px bg-line" />

        {variables.length > 0 && (
          <select
            aria-label="Insert variable"
            className="h-6 rounded border border-line bg-bg-card2 px-1 text-[11px] text-ink-dim focus:outline-none focus:ring-1 focus:ring-accent"
            value=""
            onChange={(ev) => {
              const v = variables.find((x) => x.name === ev.target.value)
              if (!v) return
              insert(v.isTimestamp ? `{{${v.name}:F}}` : `{{${v.name}}}`)
              ev.target.value = ''
            }}
          >
            <option value="">+ Variable</option>
            {variables.map((v) => (
              <option key={v.name} value={v.name}>{v.label} — {`{{${v.name}}}`}</option>
            ))}
          </select>
        )}

        <button type="button" className={iconBtn} title="Insert timestamp" onClick={() => setTsOpen((o) => !o)}>🕒</button>
      </div>

      {tsOpen && (
        <div className="rounded-md border border-line bg-bg-card2 p-2 flex flex-col gap-2">
          <div className="text-[11px] text-ink-dim">Build a Discord timestamp — renders in each viewer&apos;s own timezone.</div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="datetime-local"
              value={tsDate}
              onChange={(e) => setTsDate(e.target.value)}
              className={`${inputCls} max-w-[16rem]`}
            />
            <select
              value={tsStyle}
              onChange={(e) => setTsStyle(e.target.value as TimestampStyle)}
              className="h-8 rounded-md border border-line bg-bg-card2 px-2 text-sm text-ink focus:outline-none focus:ring-1 focus:ring-accent"
            >
              {TIMESTAMP_STYLES.map((s) => (
                <option key={s.style} value={s.style}>{s.label} ({s.hint})</option>
              ))}
            </select>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-accent">
              {tsUnix ? formatDiscordTimestamp(tsUnix, tsStyle) : 'pick a date'}
            </span>
            <button
              type="button"
              className={btnGhost}
              disabled={!tsUnix}
              onClick={() => {
                if (!tsUnix) return
                insert(discordTimestamp(tsUnix, tsStyle))
                setTsOpen(false)
              }}
            >
              Insert
            </button>
          </div>
        </div>
      )}

      <textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        placeholder={placeholder}
        className={`${inputCls} resize-y font-mono`}
      />
    </div>
  )
}

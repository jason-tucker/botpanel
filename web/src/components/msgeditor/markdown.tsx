'use client'

/**
 * Tiny Discord-flavored markdown renderer for the editor's live preview. Not a
 * full CommonMark implementation — just enough to approximate how Discord will
 * display the authored text: headings, subtext (`-#`), quotes, bullet lists,
 * bold/italic/underline/strike/inline-code/code-blocks, links, and the
 * Discord-specific `<@id>` / `<#id>` / `<@&id>` mentions, `<t:UNIX:style>`
 * timestamps, and `<:name:id>` custom emoji.
 */
import React from 'react'
import { formatDiscordTimestamp, type TimestampStyle } from '@/lib/msgspec/variables'

const mentionChip = 'rounded bg-accent/25 px-1 text-[0.95em] text-accent'
const tsChip = 'rounded bg-accent/15 px-1 text-[0.95em] text-accent'

const INLINE_RE = new RegExp(
  [
    '(`[^`]+`)', // 1 inline code
    '(\\*\\*[\\s\\S]+?\\*\\*)', // 2 bold
    '(__[\\s\\S]+?__)', // 3 underline
    '(~~[\\s\\S]+?~~)', // 4 strike
    '(\\*[\\s\\S]+?\\*)', // 5 italic *
    '(_[\\s\\S]+?_)', // 6 italic _
    '(\\[[^\\]]+\\]\\([^)\\s]+\\))', // 7 link
    '(<a?:\\w+:\\d+>)', // 8 custom emoji
    '(<t:\\d+(?::[tTdDfFR])?>)', // 9 timestamp
    '(<@!?\\d+>)', // 10 user mention
    '(<@&\\d+>)', // 11 role mention
    '(<#\\d+>)', // 12 channel mention
  ].join('|'),
)

function parseInline(text: string, keyBase: string): React.ReactNode[] {
  const out: React.ReactNode[] = []
  let rest = text
  let i = 0
  while (rest.length > 0) {
    const m = INLINE_RE.exec(rest)
    if (!m || m.index === undefined) {
      out.push(rest)
      break
    }
    if (m.index > 0) out.push(rest.slice(0, m.index))
    const token = m[0]
    const k = `${keyBase}-${i++}`

    if (m[1]) {
      out.push(<code key={k} className="rounded bg-black/40 px-1 font-mono text-[0.9em]">{token.slice(1, -1)}</code>)
    } else if (m[2]) {
      out.push(<strong key={k}>{parseInline(token.slice(2, -2), k)}</strong>)
    } else if (m[3]) {
      out.push(<u key={k}>{parseInline(token.slice(2, -2), k)}</u>)
    } else if (m[4]) {
      out.push(<s key={k}>{parseInline(token.slice(2, -2), k)}</s>)
    } else if (m[5]) {
      out.push(<em key={k}>{parseInline(token.slice(1, -1), k)}</em>)
    } else if (m[6]) {
      out.push(<em key={k}>{parseInline(token.slice(1, -1), k)}</em>)
    } else if (m[7]) {
      const mm = /\[([^\]]+)\]\(([^)\s]+)\)/.exec(token)
      out.push(
        <a key={k} href={mm?.[2]} target="_blank" rel="noreferrer" className="text-accent hover:underline">
          {mm?.[1]}
        </a>,
      )
    } else if (m[8]) {
      const name = /<a?:(\w+):/.exec(token)?.[1] ?? 'emoji'
      out.push(<span key={k} className="text-ink-dim">:{name}:</span>)
    } else if (m[9]) {
      const parts = token.slice(3, -1).split(':')
      const unix = Number(parts[0])
      const style = (parts[1] ?? 'f') as TimestampStyle
      out.push(<span key={k} className={tsChip}>{formatDiscordTimestamp(unix, style)}</span>)
    } else if (m[10]) {
      out.push(<span key={k} className={mentionChip}>@user</span>)
    } else if (m[11]) {
      out.push(<span key={k} className={mentionChip}>@role</span>)
    } else if (m[12]) {
      out.push(<span key={k} className={mentionChip}>#channel</span>)
    }
    rest = rest.slice(m.index + token.length)
  }
  return out
}

/** Render a block of markdown text (may contain newlines + fenced code). */
export function renderMarkdown(text: string, keyBase = 'md'): React.ReactNode {
  if (!text) return null
  // Pull out fenced code blocks first so their contents aren't inline-parsed.
  const segments = text.split(/```/)
  const blocks: React.ReactNode[] = []
  segments.forEach((seg, si) => {
    const isCode = si % 2 === 1
    if (isCode) {
      blocks.push(
        <pre key={`${keyBase}-code-${si}`} className="my-1 overflow-x-auto rounded bg-black/40 p-2 font-mono text-[0.85em] text-ink">
          {seg.replace(/^\n/, '').replace(/\n$/, '')}
        </pre>,
      )
      return
    }
    const lines = seg.split('\n')
    lines.forEach((line, li) => {
      const key = `${keyBase}-${si}-${li}`
      let m: RegExpExecArray | null
      if ((m = /^###\s+(.*)$/.exec(line))) {
        blocks.push(<div key={key} className="mt-1 text-sm font-semibold text-ink">{parseInline(m[1], key)}</div>)
      } else if ((m = /^##\s+(.*)$/.exec(line))) {
        blocks.push(<div key={key} className="mt-1 text-base font-bold text-ink">{parseInline(m[1], key)}</div>)
      } else if ((m = /^#\s+(.*)$/.exec(line))) {
        blocks.push(<div key={key} className="mt-1 text-lg font-bold text-ink">{parseInline(m[1], key)}</div>)
      } else if ((m = /^-#\s+(.*)$/.exec(line))) {
        blocks.push(<div key={key} className="text-[11px] text-ink-dim">{parseInline(m[1], key)}</div>)
      } else if ((m = /^>\s+(.*)$/.exec(line))) {
        blocks.push(<div key={key} className="border-l-2 border-line pl-2 text-ink/90">{parseInline(m[1], key)}</div>)
      } else if ((m = /^[-*]\s+(.*)$/.exec(line))) {
        blocks.push(<div key={key} className="flex gap-1.5 pl-1"><span className="text-ink-dim">•</span><span>{parseInline(m[1], key)}</span></div>)
      } else if (line.trim() === '') {
        blocks.push(<div key={key} className="h-2" />)
      } else {
        blocks.push(<div key={key} className="leading-snug">{parseInline(line, key)}</div>)
      }
    })
  })
  return <>{blocks}</>
}

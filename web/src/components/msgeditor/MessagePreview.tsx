'use client'

/**
 * Live, Discord-styled preview of a MessageSpec. Approximates the real client
 * render (accent bar, sections with right-floated accessory, separators, image
 * galleries, button colors) using substituted variable values so it's WYSIWYG.
 *
 * `appendedRows` lets a feature show code-appended buttons that aren't part of
 * the editable spec (e.g. game-night RSVP buttons) so the preview is complete.
 */
import React from 'react'
import type {
  ButtonSpec,
  ButtonStyleName,
  ContainerSpec,
  MessageSpec,
  SectionSpec,
} from '@/lib/msgspec/schema'
import { substitute, type SubstitutionContext } from '@/lib/msgspec/variables'
import { renderMarkdown } from './markdown'

export type PreviewButton = { label?: string; emoji?: string; style: ButtonStyleName; url?: string }

const BTN_COLORS: Record<ButtonStyleName, string> = {
  primary: 'bg-[#5865f2] text-white',
  secondary: 'bg-[#4e5058] text-white',
  success: 'bg-[#248046] text-white',
  danger: 'bg-[#da373c] text-white',
  link: 'bg-[#4e5058] text-white',
}

function hexColor(n: number | null | undefined): string {
  if (typeof n !== 'number') return '#4e5058'
  return `#${(n & 0xffffff).toString(16).padStart(6, '0')}`
}

function Button({ b, k }: { b: PreviewButton; k: string }) {
  return (
    <span
      key={k}
      className={`inline-flex items-center gap-1 rounded-[3px] px-3 py-1.5 text-[13px] font-medium ${BTN_COLORS[b.style] ?? BTN_COLORS.secondary}`}
    >
      {b.emoji && <span>{b.emoji}</span>}
      {b.label && <span>{b.label}</span>}
      {b.style === 'link' && <span aria-hidden>↗</span>}
    </span>
  )
}

function ButtonRow({ buttons, k }: { buttons: PreviewButton[]; k: string }) {
  if (buttons.length === 0) return null
  return (
    <div className="my-1 flex flex-wrap gap-2">
      {buttons.map((b, i) => <Button key={`${k}-${i}`} b={b} k={`${k}-${i}`} />)}
    </div>
  )
}

function specButtonToPreview(b: ButtonSpec, ctx: SubstitutionContext): PreviewButton {
  return { label: b.label ? substitute(b.label, ctx) : undefined, emoji: b.emoji, style: b.style, url: b.url }
}

/* eslint-disable @next/next/no-img-element */
function Img({ url, alt, className }: { url: string; alt: string; className: string }) {
  if (!/^https?:\/\//i.test(url)) {
    return <div className={`${className} flex items-center justify-center bg-black/40 text-[10px] text-ink-dim`}>image url…</div>
  }
  return <img src={url} alt={alt} className={className} />
}
/* eslint-enable @next/next/no-img-element */

function Section({ sec, ctx, k }: { sec: SectionSpec; ctx: SubstitutionContext; k: string }) {
  const acc = sec.accessory
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1 text-[15px] text-ink">
        {sec.content.map((line, i) => (
          <div key={`${k}-l-${i}`}>{renderMarkdown(substitute(line, ctx), `${k}-l-${i}`)}</div>
        ))}
      </div>
      {acc.type === 'thumbnail' ? (
        <Img url={substitute(acc.url, ctx)} alt={acc.description ?? ''} className="h-16 w-16 shrink-0 rounded object-cover" />
      ) : (
        <div className="shrink-0">
          <Button b={specButtonToPreview(acc, ctx)} k={`${k}-acc`} />
        </div>
      )}
    </div>
  )
}

function Container({ c, ctx, k }: { c: ContainerSpec; ctx: SubstitutionContext; k: string }) {
  return (
    <div
      className="rounded-[4px] border-l-4 bg-[#2b2d31] py-2 pl-3 pr-3"
      style={{ borderLeftColor: hexColor(c.accentColor) }}
    >
      <div className="flex flex-col gap-1.5">
        {c.components.map((child, i) => {
          const ck = `${k}-${i}`
          switch (child.type) {
            case 'text':
              return <div key={ck} className="text-[15px] text-ink">{renderMarkdown(substitute(child.content, ctx), ck)}</div>
            case 'section':
              return <Section key={ck} sec={child} ctx={ctx} k={ck} />
            case 'separator':
              return (
                <div key={ck} className={child.spacing === 'large' ? 'py-2' : 'py-1'}>
                  {child.divider !== false && <div className="h-px w-full bg-white/10" />}
                </div>
              )
            case 'media': {
              const items = child.items.filter((it) => it.url)
              return (
                <div key={ck} className={`grid gap-1 ${items.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                  {items.map((it, j) => (
                    <Img key={`${ck}-${j}`} url={substitute(it.url, ctx)} alt={it.description ?? ''} className="max-h-48 w-full rounded object-cover" />
                  ))}
                </div>
              )
            }
            case 'action_row':
              return <ButtonRow key={ck} k={ck} buttons={child.components.map((b) => specButtonToPreview(b, ctx))} />
            default:
              return null
          }
        })}
      </div>
    </div>
  )
}

export function MessagePreview({
  spec,
  ctx,
  appendedRows = [],
}: {
  spec: MessageSpec
  ctx: SubstitutionContext
  appendedRows?: PreviewButton[][]
}) {
  return (
    <div className="rounded-lg bg-[#313338] p-3 font-sans">
      <div className="mb-2 flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent/30 text-sm">🤖</div>
        <span className="text-sm font-medium text-ink">SquishyBot</span>
        <span className="rounded bg-accent/20 px-1 text-[10px] uppercase tracking-wide text-accent">App</span>
      </div>
      <div className="flex flex-col gap-2">
        {spec.components.map((top, i) => {
          const k = `top-${i}`
          if (top.type === 'container') return <Container key={k} c={top} ctx={ctx} k={k} />
          if (top.type === 'action_row') return <ButtonRow key={k} k={k} buttons={top.components.map((b) => specButtonToPreview(b, ctx))} />
          return null
        })}
        {appendedRows.map((row, i) => (
          <ButtonRow key={`appended-${i}`} k={`appended-${i}`} buttons={row} />
        ))}
      </div>
    </div>
  )
}

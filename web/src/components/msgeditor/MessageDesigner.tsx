'use client'

/**
 * MessageDesigner — the reusable Components-V2 message editor.
 *
 * Generic: it edits a `MessageSpec` (no game-night knowledge) and renders a
 * live preview beside the structure editor. Any panel feature can mount it;
 * pass `variables` for the insert menu and `previewCtx` so the preview shows
 * substituted values. `appendedRows` shows code-appended buttons (e.g. RSVP)
 * in the preview.
 *
 * Structure model surfaced to the user: a list of Containers, each holding
 * text / section / separator / image-gallery / link-button-row children.
 * Author-added buttons are link buttons only (interactive buttons need a bot
 * handler — those are appended by the feature, not designed here).
 */
import { useState } from 'react'
import type {
  ActionRowSpec,
  ButtonSpec,
  ContainerChildSpec,
  ContainerSpec,
  MediaGallerySpec,
  MessageSpec,
  SectionSpec,
  SeparatorSpec,
  TextDisplaySpec,
  TopComponentSpec,
} from '@/lib/msgspec/schema'
import type { SubstitutionContext, VariableDef } from '@/lib/msgspec/variables'
import {
  CONTAINER_CHILD_FACTORIES,
  newContainer,
  newLinkButton,
} from '@/lib/msgspec/defaults'
import { RichTextField } from './RichTextField'
import { MessagePreview, type PreviewButton } from './MessagePreview'
import { inputCls, labelCls, btnGhost, btnAccent, iconBtn, nodeCard } from './styles'

// ── immutable array helpers ────────────────────────────────────────────────
function replaceAt<T>(arr: T[], i: number, v: T): T[] {
  const c = arr.slice()
  c[i] = v
  return c
}
function removeAt<T>(arr: T[], i: number): T[] {
  const c = arr.slice()
  c.splice(i, 1)
  return c
}
function moveAt<T>(arr: T[], i: number, dir: -1 | 1): T[] {
  const j = i + dir
  if (j < 0 || j >= arr.length) return arr
  const c = arr.slice()
  ;[c[i], c[j]] = [c[j], c[i]]
  return c
}

const ACCENT_PRESETS = [0xfbbf24, 0x5865f2, 0x57f287, 0xeb459e, 0xed4245, 0x9b59b6, 0x3498db, 0xe67e22]

function intToHex(n: number): string {
  return `#${(n & 0xffffff).toString(16).padStart(6, '0')}`
}
function hexToInt(h: string): number {
  return parseInt(h.replace('#', ''), 16) || 0
}

// ── row controls (move up/down/remove) ─────────────────────────────────────
function RowControls({ onUp, onDown, onRemove, removeTitle }: { onUp: () => void; onDown: () => void; onRemove: () => void; removeTitle?: string }) {
  return (
    <div className="flex items-center gap-1">
      <button type="button" className={iconBtn} title="Move up" onClick={onUp}>↑</button>
      <button type="button" className={iconBtn} title="Move down" onClick={onDown}>↓</button>
      <button type="button" className={`${iconBtn} hover:!text-err`} title={removeTitle ?? 'Remove'} onClick={onRemove}>✕</button>
    </div>
  )
}

// ── button (link) editor ───────────────────────────────────────────────────
function LinkButtonEditor({ value, onChange }: { value: ButtonSpec; onChange: (b: ButtonSpec) => void }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-[1fr_1.4fr_auto] gap-2">
      <input className={inputCls} placeholder="Label" value={value.label ?? ''} onChange={(e) => onChange({ ...value, label: e.target.value })} />
      <input className={inputCls} placeholder="https://…" value={value.url ?? ''} onChange={(e) => onChange({ ...value, url: e.target.value })} />
      <input className={`${inputCls} w-16 text-center`} placeholder="🎮" value={value.emoji ?? ''} onChange={(e) => onChange({ ...value, emoji: e.target.value })} />
    </div>
  )
}

// ── accessory (thumbnail | button) editor ──────────────────────────────────
function AccessoryEditor({ value, onChange }: { value: SectionSpec['accessory']; onChange: (a: SectionSpec['accessory']) => void }) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-line/60 bg-bg-card/40 p-2">
      <div className="flex items-center gap-2">
        <span className={labelCls}>Accessory</span>
        <select
          className="h-7 rounded border border-line bg-bg-card2 px-1 text-xs text-ink focus:outline-none focus:ring-1 focus:ring-accent"
          value={value.type}
          onChange={(e) => onChange(e.target.value === 'button' ? newLinkButton() : { type: 'thumbnail', url: '' })}
        >
          <option value="thumbnail">Thumbnail image</option>
          <option value="button">Link button</option>
        </select>
      </div>
      {value.type === 'thumbnail' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <input className={inputCls} placeholder="Image URL (https://…)" value={value.url} onChange={(e) => onChange({ ...value, url: e.target.value })} />
          <input className={inputCls} placeholder="Alt text (optional)" value={value.description ?? ''} onChange={(e) => onChange({ ...value, description: e.target.value })} />
        </div>
      ) : (
        <LinkButtonEditor value={value} onChange={(b) => onChange(b)} />
      )}
    </div>
  )
}

// ── per-child editors ──────────────────────────────────────────────────────
function ChildEditor({
  child,
  variables,
  onChange,
}: {
  child: ContainerChildSpec
  variables: VariableDef[]
  onChange: (c: ContainerChildSpec) => void
}) {
  switch (child.type) {
    case 'text': {
      const t = child as TextDisplaySpec
      return <RichTextField value={t.content} onChange={(v) => onChange({ ...t, content: v })} variables={variables} placeholder="Markdown text…" />
    }
    case 'section': {
      const s = child as SectionSpec
      return (
        <div className="flex flex-col gap-2">
          {s.content.map((line, i) => (
            <div key={i} className="flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <span className={labelCls}>Line {i + 1}</span>
                {s.content.length > 1 && (
                  <button type="button" className={btnGhost} onClick={() => onChange({ ...s, content: removeAt(s.content, i) })}>Remove line</button>
                )}
              </div>
              <RichTextField value={line} onChange={(v) => onChange({ ...s, content: replaceAt(s.content, i, v) })} variables={variables} rows={2} />
            </div>
          ))}
          {s.content.length < 3 && (
            <button type="button" className={btnGhost} onClick={() => onChange({ ...s, content: [...s.content, ''] })}>+ Add line</button>
          )}
          <AccessoryEditor value={s.accessory} onChange={(a) => onChange({ ...s, accessory: a })} />
        </div>
      )
    }
    case 'separator': {
      const sep = child as SeparatorSpec
      return (
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={sep.divider !== false} onChange={(e) => onChange({ ...sep, divider: e.target.checked })} />
            Show divider line
          </label>
          <label className="flex items-center gap-2 text-sm text-ink">
            Spacing
            <select
              className="h-7 rounded border border-line bg-bg-card2 px-1 text-xs text-ink focus:outline-none focus:ring-1 focus:ring-accent"
              value={sep.spacing ?? 'small'}
              onChange={(e) => onChange({ ...sep, spacing: e.target.value as 'small' | 'large' })}
            >
              <option value="small">Small</option>
              <option value="large">Large</option>
            </select>
          </label>
        </div>
      )
    }
    case 'media': {
      const m = child as MediaGallerySpec
      return (
        <div className="flex flex-col gap-2">
          {m.items.map((it, i) => (
            <div key={i} className="grid grid-cols-1 sm:grid-cols-[1.6fr_1fr_auto_auto] items-center gap-2">
              <input className={inputCls} placeholder="Image URL (https://…)" value={it.url} onChange={(e) => onChange({ ...m, items: replaceAt(m.items, i, { ...it, url: e.target.value }) })} />
              <input className={inputCls} placeholder="Alt (optional)" value={it.description ?? ''} onChange={(e) => onChange({ ...m, items: replaceAt(m.items, i, { ...it, description: e.target.value }) })} />
              <label className="flex items-center gap-1 text-[11px] text-ink-dim">
                <input type="checkbox" checked={!!it.spoiler} onChange={(e) => onChange({ ...m, items: replaceAt(m.items, i, { ...it, spoiler: e.target.checked }) })} />
                Spoiler
              </label>
              {m.items.length > 1 && <button type="button" className={iconBtn} title="Remove image" onClick={() => onChange({ ...m, items: removeAt(m.items, i) })}>✕</button>}
            </div>
          ))}
          {m.items.length < 10 && (
            <button type="button" className={btnGhost} onClick={() => onChange({ ...m, items: [...m.items, { url: '' }] })}>+ Add image</button>
          )}
        </div>
      )
    }
    case 'action_row': {
      const r = child as ActionRowSpec
      return (
        <div className="flex flex-col gap-2">
          <span className="text-[11px] text-ink-dim">Link buttons only — they open a URL. (RSVP / interactive buttons are added automatically by the bot.)</span>
          {r.components.map((b, i) => (
            <div key={i} className="flex items-start gap-2">
              <div className="flex-1"><LinkButtonEditor value={{ ...b, style: 'link' }} onChange={(nb) => onChange({ ...r, components: replaceAt(r.components, i, { ...nb, style: 'link' }) })} /></div>
              {r.components.length > 1 && <button type="button" className={iconBtn} title="Remove button" onClick={() => onChange({ ...r, components: removeAt(r.components, i) })}>✕</button>}
            </div>
          ))}
          {r.components.length < 5 && (
            <button type="button" className={btnGhost} onClick={() => onChange({ ...r, components: [...r.components, newLinkButton()] })}>+ Add button</button>
          )}
        </div>
      )
    }
    default:
      return null
  }
}

const CHILD_LABEL: Record<ContainerChildSpec['type'], string> = {
  text: 'Text',
  section: 'Section',
  separator: 'Separator',
  media: 'Image gallery',
  action_row: 'Link buttons',
}

// ── container editor ───────────────────────────────────────────────────────
function ContainerEditor({
  container,
  variables,
  onChange,
}: {
  container: ContainerSpec
  variables: VariableDef[]
  onChange: (c: ContainerSpec) => void
}) {
  const [addOpen, setAddOpen] = useState(false)
  const accentOn = typeof container.accentColor === 'number'
  return (
    <div className="rounded-xl border border-line bg-bg-card p-3 flex flex-col gap-3">
      {/* accent color row */}
      <div className="flex flex-wrap items-center gap-2">
        <span className={labelCls}>Accent</span>
        <label className="flex items-center gap-1 text-xs text-ink-dim">
          <input type="checkbox" checked={accentOn} onChange={(e) => onChange({ ...container, accentColor: e.target.checked ? 0x5865f2 : null })} />
          on
        </label>
        {accentOn && (
          <>
            <input
              type="color"
              value={intToHex(container.accentColor as number)}
              onChange={(e) => onChange({ ...container, accentColor: hexToInt(e.target.value) })}
              className="h-7 w-9 cursor-pointer rounded border border-line bg-bg-card2"
            />
            <div className="flex items-center gap-1">
              {ACCENT_PRESETS.map((c) => (
                <button
                  key={c}
                  type="button"
                  title={intToHex(c)}
                  onClick={() => onChange({ ...container, accentColor: c })}
                  className="h-5 w-5 rounded-full border border-line"
                  style={{ backgroundColor: intToHex(c) }}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* children */}
      <div className="flex flex-col gap-2">
        {container.components.map((child, i) => (
          <div key={i} className={nodeCard}>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-medium uppercase tracking-wider text-ink-dim">{CHILD_LABEL[child.type]}</span>
              <RowControls
                onUp={() => onChange({ ...container, components: moveAt(container.components, i, -1) })}
                onDown={() => onChange({ ...container, components: moveAt(container.components, i, 1) })}
                onRemove={() => onChange({ ...container, components: removeAt(container.components, i) })}
              />
            </div>
            <ChildEditor child={child} variables={variables} onChange={(c) => onChange({ ...container, components: replaceAt(container.components, i, c) })} />
          </div>
        ))}
      </div>

      {/* add child */}
      <div className="relative">
        <button type="button" className={btnAccent} onClick={() => setAddOpen((o) => !o)}>+ Add component</button>
        {addOpen && (
          <div className="absolute z-10 mt-1 flex w-56 flex-col rounded-md border border-line bg-bg-card2 p-1 shadow-lg">
            {CONTAINER_CHILD_FACTORIES.map((f) => (
              <button
                key={f.kind}
                type="button"
                className="rounded px-2 py-1.5 text-left text-sm text-ink hover:bg-bg-card"
                onClick={() => {
                  onChange({ ...container, components: [...container.components, f.make()] })
                  setAddOpen(false)
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── top-level designer ─────────────────────────────────────────────────────
export function MessageDesigner({
  value,
  onChange,
  variables,
  previewCtx,
  appendedRows = [],
}: {
  value: MessageSpec
  onChange: (spec: MessageSpec) => void
  variables: VariableDef[]
  previewCtx: SubstitutionContext
  appendedRows?: PreviewButton[][]
}) {
  const setTop = (i: number, v: TopComponentSpec) => onChange({ ...value, components: replaceAt(value.components, i, v) })

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {/* editor column */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-ink">Message</h3>
          <label className="flex items-center gap-1.5 text-[11px] text-ink-dim">
            <input
              type="checkbox"
              checked={!!value.suppressNotifications}
              onChange={(e) => onChange({ ...value, suppressNotifications: e.target.checked })}
            />
            Send silently (no push)
          </label>
        </div>

        {value.components.map((top, i) =>
          top.type === 'container' ? (
            <div key={i} className="flex flex-col gap-1">
              <div className="flex items-center justify-between px-1">
                <span className="text-[11px] uppercase tracking-wider text-ink-dim">Container {i + 1}</span>
                <RowControls
                  onUp={() => onChange({ ...value, components: moveAt(value.components, i, -1) })}
                  onDown={() => onChange({ ...value, components: moveAt(value.components, i, 1) })}
                  onRemove={() => onChange({ ...value, components: removeAt(value.components, i) })}
                  removeTitle="Remove container"
                />
              </div>
              <ContainerEditor container={top} variables={variables} onChange={(c) => setTop(i, c)} />
            </div>
          ) : (
            <div key={i} className={nodeCard}>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[11px] uppercase tracking-wider text-ink-dim">Top-level button row</span>
                <RowControls
                  onUp={() => onChange({ ...value, components: moveAt(value.components, i, -1) })}
                  onDown={() => onChange({ ...value, components: moveAt(value.components, i, 1) })}
                  onRemove={() => onChange({ ...value, components: removeAt(value.components, i) })}
                />
              </div>
              <ChildEditor child={top} variables={variables} onChange={(c) => c.type === 'action_row' && setTop(i, c)} />
            </div>
          ),
        )}

        <button
          type="button"
          className={btnGhost}
          onClick={() => onChange({ ...value, components: [...value.components, newContainer()] })}
        >
          + Add container
        </button>
        {value.components.length > 1 && (
          <p className="text-[11px] text-ink-dim">Tip: most posts use a single container. Add more only if you want separate accent-colored blocks.</p>
        )}
      </div>

      {/* preview column */}
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium text-ink">Live preview</h3>
        <div className="lg:sticky lg:top-4">
          <MessagePreview spec={value} ctx={previewCtx} appendedRows={appendedRows} />
          <p className="mt-2 text-[11px] text-ink-dim">
            Approximate render. Timestamps + relative times show in your timezone; each viewer sees their own. Variables show sample values.
          </p>
        </div>
      </div>
    </div>
  )
}

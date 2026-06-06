/**
 * Factory helpers for new spec nodes (used by the editor's "add" buttons) and
 * the game-night starter content + variable catalog.
 *
 * The factories live here (not in the editor) so any panel feature can reuse
 * them; the game-night specifics are clearly separated at the bottom.
 */
import { MSGSPEC_VERSION } from './schema'
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
} from './schema'
import type { VariableDef } from './variables'

// ── Generic node factories ────────────────────────────────────────────────

export function newText(content = ''): TextDisplaySpec {
  return { type: 'text', content }
}

export function newSeparator(): SeparatorSpec {
  return { type: 'separator', divider: true, spacing: 'small' }
}

export function newSection(): SectionSpec {
  return {
    type: 'section',
    content: [''],
    accessory: { type: 'thumbnail', url: '' },
  }
}

export function newMedia(): MediaGallerySpec {
  return { type: 'media', items: [{ url: '' }] }
}

export function newLinkButton(): ButtonSpec {
  return { type: 'button', style: 'link', label: 'Link', url: '' }
}

export function newActionRow(): ActionRowSpec {
  return { type: 'action_row', components: [newLinkButton()] }
}

export function newContainer(): ContainerSpec {
  return { type: 'container', accentColor: 0x5865f2, components: [newText('')] }
}

export const CONTAINER_CHILD_FACTORIES: { kind: ContainerChildSpec['type']; label: string; make: () => ContainerChildSpec }[] = [
  { kind: 'text', label: 'Text', make: newText },
  { kind: 'section', label: 'Section + accessory', make: newSection },
  { kind: 'separator', label: 'Separator', make: newSeparator },
  { kind: 'media', label: 'Image gallery', make: newMedia },
  { kind: 'action_row', label: 'Link buttons', make: newActionRow },
]

export function emptyMessageSpec(): MessageSpec {
  return { version: MSGSPEC_VERSION, components: [newContainer()] }
}

// ── Game-night specifics ──────────────────────────────────────────────────

/** Variables surfaced in the editor's insert menu for game-night posts. */
export function gameNightVariables(eventUnix?: number): VariableDef[] {
  const sampleUnix = eventUnix ?? Math.floor(Date.now() / 1000) + 3 * 3600
  return [
    { name: 'game', label: 'Game name', sample: 'Lethal Company' },
    { name: 'when', label: 'Event time', sample: '', isTimestamp: true, sampleUnix, description: 'Insert as {{when:F}}, {{when:R}}, etc.' },
    { name: 'host', label: 'Host (mention)', sample: '@you' },
    { name: 'channel', label: 'This channel', sample: '#game-night' },
    { name: 'notes', label: 'Notes', sample: 'BYO snacks 🍿' },
    { name: 'rsvp', label: 'RSVP summary block', sample: '✅ **Joining (2):** @ana, @ben\n🤔 **Might join (1):** @cal\n❌ **Not joining (0):** _none_' },
    { name: 'count.in', label: '# joining', sample: '2' },
    { name: 'count.maybe', label: '# maybe', sample: '1' },
    { name: 'count.out', label: '# not joining', sample: '0' },
    { name: 'count.needs', label: '# need a copy', sample: '1' },
    { name: 'list.in', label: 'Joining list', sample: '@ana, @ben' },
    { name: 'list.maybe', label: 'Maybe list', sample: '@cal' },
    { name: 'list.out', label: 'Not-joining list', sample: '_none_' },
    { name: 'list.needs', label: 'Need-a-copy list', sample: '@ben' },
  ]
}

/** A polished starter spec for a new game-night post. */
export function gameNightDefaultSpec(): MessageSpec {
  return {
    version: MSGSPEC_VERSION,
    components: [
      {
        type: 'container',
        accentColor: 0xfbbf24, // gold — matches the legacy in-Discord panel
        components: [
          newText('## 🎲 Game Night — {{game}}'),
          newText('📅 {{when:F}}  ·  {{when:R}}'),
          newText('{{notes}}'),
          { type: 'separator', divider: true, spacing: 'small' },
          newText('{{rsvp}}'),
          { type: 'separator', divider: true, spacing: 'small' },
          newText('-# Host: {{host}} · React below to RSVP'),
        ],
      },
    ],
  }
}

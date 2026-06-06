/**
 * Portable "message spec" — the reusable Components-V2 message format authored
 * by the panel's embed editor and rendered by the bot.
 *
 * This is the single source of truth for the shape on the panel side; the bot
 * keeps a hand-written mirror in `src/services/msgspec/types.ts`. Keep the two
 * in sync — the `version` field lets us evolve without breaking stored rows.
 *
 * The editor is generic (any panel feature can embed it); "game night" is just
 * the first consumer. Nothing here is squishy- or game-night-specific.
 */
import { z } from 'zod'

export const MSGSPEC_VERSION = 1

export const BUTTON_STYLES = ['primary', 'secondary', 'success', 'danger', 'link'] as const
export const SEPARATOR_SPACINGS = ['small', 'large'] as const

const buttonSpec = z.object({
  type: z.literal('button'),
  style: z.enum(BUTTON_STYLES),
  label: z.string().max(80).optional(),
  emoji: z.string().max(64).optional(),
  // Required (and validated) for link buttons; the editor only emits link
  // buttons for author-added buttons, but the shape allows interactive ones
  // for code-appended rows (RSVP etc).
  url: z.string().max(512).optional(),
  customId: z.string().max(100).optional(),
  disabled: z.boolean().optional(),
})

const thumbnailSpec = z.object({
  type: z.literal('thumbnail'),
  url: z.string().max(1024),
  description: z.string().max(256).optional(),
  spoiler: z.boolean().optional(),
})

const textDisplaySpec = z.object({
  type: z.literal('text'),
  content: z.string().max(4000),
})

const sectionSpec = z.object({
  type: z.literal('section'),
  content: z.array(z.string().max(2000)).min(1).max(3),
  accessory: z.union([buttonSpec, thumbnailSpec]),
})

const separatorSpec = z.object({
  type: z.literal('separator'),
  divider: z.boolean().optional(),
  spacing: z.enum(SEPARATOR_SPACINGS).optional(),
})

const mediaItemSpec = z.object({
  url: z.string().max(1024),
  description: z.string().max(256).optional(),
  spoiler: z.boolean().optional(),
})

const mediaGallerySpec = z.object({
  type: z.literal('media'),
  items: z.array(mediaItemSpec).min(1).max(10),
})

const actionRowSpec = z.object({
  type: z.literal('action_row'),
  components: z.array(buttonSpec).min(1).max(5),
})

const containerChildSpec = z.union([
  textDisplaySpec,
  sectionSpec,
  separatorSpec,
  mediaGallerySpec,
  actionRowSpec,
])

const containerSpec = z.object({
  type: z.literal('container'),
  accentColor: z.number().int().min(0).max(0xffffff).nullable().optional(),
  spoiler: z.boolean().optional(),
  components: z.array(containerChildSpec).min(1).max(40),
})

const topComponentSpec = z.union([containerSpec, actionRowSpec])

export const messageSpecSchema = z.object({
  version: z.number().int(),
  suppressNotifications: z.boolean().optional(),
  components: z.array(topComponentSpec).min(1).max(10),
})

export type ButtonSpec = z.infer<typeof buttonSpec>
export type ThumbnailSpec = z.infer<typeof thumbnailSpec>
export type TextDisplaySpec = z.infer<typeof textDisplaySpec>
export type SectionSpec = z.infer<typeof sectionSpec>
export type SeparatorSpec = z.infer<typeof separatorSpec>
export type MediaItemSpec = z.infer<typeof mediaItemSpec>
export type MediaGallerySpec = z.infer<typeof mediaGallerySpec>
export type ActionRowSpec = z.infer<typeof actionRowSpec>
export type ContainerChildSpec = z.infer<typeof containerChildSpec>
export type ContainerSpec = z.infer<typeof containerSpec>
export type TopComponentSpec = z.infer<typeof topComponentSpec>
export type MessageSpec = z.infer<typeof messageSpecSchema>
export type ButtonStyleName = (typeof BUTTON_STYLES)[number]

/**
 * Parse/validate an unknown value as a MessageSpec. Returns the typed spec or
 * a flat list of human-readable error strings (used by the API routes).
 */
export function parseMessageSpec(
  input: unknown,
): { ok: true; spec: MessageSpec } | { ok: false; errors: string[] } {
  const result = messageSpecSchema.safeParse(input)
  if (result.success) return { ok: true, spec: result.data }
  const errors = result.error.issues.map(
    (i) => `${i.path.join('.') || '(root)'}: ${i.message}`,
  )
  return { ok: false, errors }
}

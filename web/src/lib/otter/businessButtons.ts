/**
 * Server-side helper for fetching a business's custom command buttons over
 * RPC. Used by the `/otter/businesses/[slug]` page to surface the
 * `<BusinessButtonsEditor>` island. Returns the button list, or `null`-shaped
 * error on RPC failure so the page can render a friendly "couldn't load" card.
 *
 * The actor's manager+ rank is re-checked bot-side; we pass `actorUserId` so
 * the bot can verify without trusting the panel-level affordance alone.
 */
import { callBot } from '@/lib/botrpc'

export type ButtonType = 'link' | 'info'
export type ButtonStyle = 'primary' | 'secondary' | 'success' | 'danger'

export interface ButtonItem {
  id: string
  type: ButtonType
  label: string
  emoji: string | null
  style: ButtonStyle
  url: string | null
  body: string | null
  sortOrder: number
  enabled: boolean
}

interface ListReply {
  businessSlug: string
  buttons: ButtonItem[]
}

export async function loadBusinessButtons(
  businessSlug: string,
  actorUserId: string,
): Promise<{ ok: true; items: ButtonItem[] } | { ok: false; error: string }> {
  const reply = await callBot<ListReply>('otter', 'business_buttons.list', {
    businessSlug,
    actorUserId,
  })
  if (!reply.ok) return { ok: false, error: reply.error }
  return { ok: true, items: reply.data.buttons }
}

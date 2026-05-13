/**
 * Server-side helper for fetching `business_messages` over RPC.
 *
 * Used by the `/otter/caked` and `/otter/oc-stock` page components to
 * surface the editable card body list. Returns an array of items the
 * `<BusinessMessageEditor>` client island can render directly, or
 * `null` on RPC failure (the page falls back to a friendly "couldn't
 * load editor" card).
 *
 * The actor's manager+ rank is re-checked on the bot side; we still
 * pass `actorUserId` so the bot can do that check without trusting
 * the panel-level affordance alone.
 */
import { callBot } from '@/lib/botrpc'
import type { MessageItem } from '@/components/otter/BusinessMessageEditor'

interface ListReply {
  businessSlug: string
  messages: Array<{
    key: string
    label: string
    body: string
    defaultBody: string
    isOverride: boolean
    updatedAt: string | null
    updatedBy: string | null
  }>
}

export async function loadBusinessMessages(
  businessSlug: string,
  actorUserId: string,
): Promise<{ ok: true; items: MessageItem[] } | { ok: false; error: string }> {
  const reply = await callBot<ListReply>('otter', 'business_messages.list', {
    businessSlug,
    actorUserId,
  })
  if (!reply.ok) {
    return { ok: false, error: reply.error }
  }
  return {
    ok: true,
    items: reply.data.messages.map((m) => ({
      key: m.key,
      label: m.label,
      body: m.body,
      defaultBody: m.defaultBody,
      isOverride: m.isOverride,
      updatedAt: m.updatedAt,
      updatedBy: m.updatedBy,
    })),
  }
}

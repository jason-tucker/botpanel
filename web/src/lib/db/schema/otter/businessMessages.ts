import { pgTable, text, uuid, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core'

/**
 * Per-business overrides for the bodies of editable Components V2 cards
 * (today: `/caked` Contact/Event/Pricing buttons and `/oc` Requirements).
 *
 * The bot's renderers read `(business_id, message_key)` → `body` and fall
 * back to the hardcoded default string when no row exists. The set of
 * valid `message_key`s is owned by the renderers themselves (see the
 * `CAKED_EDITABLE_KEYS` / `OC_EDITABLE_KEYS` exports) — the panel and the
 * RPC verbs validate against that allowlist before writing.
 *
 * NOTE: `businessId` is a logical FK to `businesses.id` but NOT declared
 * via `.references(...)` here — deactivating a business shouldn't cascade
 * away message overrides, and the app code handles slug→id resolution
 * anyway. Cleanup on hard-delete is a panel concern.
 */
export const businessMessages = pgTable('business_messages', {
  id: uuid('id').defaultRandom().primaryKey(),
  businessId: uuid('business_id').notNull(),
  messageKey: text('message_key').notNull(),
  body: text('body').notNull(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  updatedByDiscordId: text('updated_by_discord_id'),
}, (t) => ({
  businessKeyUq: uniqueIndex('business_messages_business_key_uq').on(t.businessId, t.messageKey),
  businessIdx: index('business_messages_business_idx').on(t.businessId),
}))

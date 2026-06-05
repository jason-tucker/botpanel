// AUTO-GENERATED — DO NOT EDIT. Run scripts/sync-schema.sh in botpanel repo.
import { pgTable, uuid, text, integer, boolean, timestamp, index } from 'drizzle-orm/pg-core'

/**
 * Manager-configurable custom buttons appended to a business's slash command
 * output (`/oc`, `/caked`, and the generic `/info`). Two kinds:
 *
 *   - `link` — a Discord link button that opens `url` (no interaction round
 *     trip; Discord handles the click).
 *   - `info` — a button (custom id `bizbtn:show:{id}`) that reveals `body` as
 *     a Components V2 card, ephemerally, with a Send-to-Channel option —
 *     same shape as the `/caked` Pricing card.
 *
 * Managed two ways, both gated to manager+ of the business:
 *   - in Discord, via the "Manage Buttons" panel on each command
 *     (`src/interactions/buttons/businessButtonsButton.ts`)
 *   - in botpanel, via the buttons editor on `/otter/businesses/[slug]`
 *     (driven by the `business_buttons.*` RPC verbs).
 *
 * NOTE: `businessId` is a logical FK to `businesses.id` but NOT declared via
 * `.references(...)` — mirrors `business_messages`: deactivating a business
 * shouldn't cascade away its buttons, and slug→id resolution is handled in
 * app code anyway. Hard-delete cleanup is a panel concern.
 */
export const businessButtons = pgTable('business_buttons', {
  id: uuid('id').defaultRandom().primaryKey(),
  businessId: uuid('business_id').notNull(),
  /** 'link' opens a URL; 'info' reveals an editable card body. */
  type: text('type').$type<'link' | 'info'>().notNull(),
  /** Button label shown on the command (Discord max 80 chars). */
  label: text('label').notNull(),
  /** Optional emoji — unicode or a `<:name:id>` custom-emoji string. */
  emoji: text('emoji'),
  /** Visual style for `info` buttons. `link` buttons always render as Link. */
  style: text('style')
    .$type<'primary' | 'secondary' | 'success' | 'danger'>()
    .notNull()
    .default('primary'),
  /** Target URL for `link` buttons (http/https). */
  url: text('url'),
  /** Card body revealed by `info` buttons (markdown). */
  body: text('body'),
  /** Ordering within the command output; lower comes first. */
  sortOrder: integer('sort_order').notNull().default(0),
  /** Disabled buttons stay configured but aren't rendered on the command. */
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  createdByDiscordId: text('created_by_discord_id'),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  updatedByDiscordId: text('updated_by_discord_id'),
}, (t) => ({
  businessIdx: index('business_buttons_business_idx').on(t.businessId),
}))

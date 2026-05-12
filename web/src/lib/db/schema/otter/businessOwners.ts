// AUTO-GENERATED — DO NOT EDIT. Run scripts/sync-schema.sh in botpanel repo.
import { pgTable, uuid, text, timestamp, unique, index } from 'drizzle-orm/pg-core'
import { businesses } from './businesses'

/**
 * Stores designated owner Discord user IDs per business.
 * This is the authoritative source for business ownership — not Discord roles.
 * Only sudo users can add/remove entries here (via /portal).
 */
export const businessOwners = pgTable('business_owners', {
  id: uuid('id').defaultRandom().primaryKey(),
  businessId: uuid('business_id')
    .notNull()
    .references(() => businesses.id, { onDelete: 'cascade' }),
  discordUserId: text('discord_user_id').notNull(),
  addedByDiscordId: text('added_by_discord_id').notNull(),
  addedAt: timestamp('added_at').notNull().defaultNow(),
}, (table) => [
  unique('uq_owner_per_business').on(table.businessId, table.discordUserId),
  // permissionService.isBusinessOwner / resolveBusinesses filter by
  // discord_user_id on every interaction — hot path with no covering index.
  index('idx_business_owners_user').on(table.discordUserId),
])

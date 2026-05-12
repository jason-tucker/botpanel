// AUTO-GENERATED — DO NOT EDIT. Run scripts/sync-schema.sh in botpanel repo.
import { pgTable, uuid, text, timestamp, unique, index } from 'drizzle-orm/pg-core'
import { businesses } from './businesses'

export const standings = pgTable('standings', {
  id: uuid('id').defaultRandom().primaryKey(),
  businessId: uuid('business_id')
    .notNull()
    .references(() => businesses.id, { onDelete: 'cascade' }),
  characterId: text('character_id').notNull(),
  characterName: text('character_name').notNull(),
  standing: text('standing').$type<'good' | 'neutral' | 'bad' | 'blacklisted'>().notNull().default('neutral'),
  reason: text('reason'),
  updatedByDiscordId: text('updated_by_discord_id').notNull(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  unique('uq_standing_per_business_char').on(table.businessId, table.characterId),
  // "All bad/blacklisted in this business" filters by (business, standing).
  // The unique covers (business, character) but not standing as 2nd key.
  index('idx_standings_biz_standing').on(table.businessId, table.standing),
])

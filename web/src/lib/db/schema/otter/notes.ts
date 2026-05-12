// AUTO-GENERATED — DO NOT EDIT. Run scripts/sync-schema.sh in botpanel repo.
import { pgTable, uuid, text, timestamp, index } from 'drizzle-orm/pg-core'
import { businesses } from './businesses'

export const notes = pgTable('notes', {
  id: uuid('id').defaultRandom().primaryKey(),
  businessId: uuid('business_id')
    .notNull()
    .references(() => businesses.id, { onDelete: 'cascade' }),
  characterId: text('character_id').notNull(),
  characterName: text('character_name').notNull(),
  content: text('content').notNull(),
  authorDiscordId: text('author_discord_id').notNull(),
  authorName: text('author_name').notNull(),
  visibility: text('visibility').$type<'staff' | 'manager' | 'owner'>().notNull().default('staff'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  // noteView + lookup filter notes by (businessId, characterId) and order by
  // created_at desc. Single composite covers both the WHERE and ORDER BY.
  index('idx_notes_biz_char_created').on(table.businessId, table.characterId, table.createdAt.desc()),
])

// AUTO-GENERATED — DO NOT EDIT. Run scripts/sync-schema.sh in botpanel repo.
import { pgTable, uuid, text, timestamp, integer } from 'drizzle-orm/pg-core'

export const ocStock = pgTable('oc_stock', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  status: text('status').$type<'in_stock' | 'low_stock' | 'out_of_stock'>().notNull().default('in_stock'),
  sortOrder: integer('sort_order').notNull().default(0),
  url: text('url'),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  updatedByDiscordId: text('updated_by_discord_id'),
})

// AUTO-GENERATED — DO NOT EDIT. Run scripts/sync-schema.sh in botpanel repo.
import { pgTable, uuid, text, boolean, jsonb, timestamp, index } from 'drizzle-orm/pg-core'

export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  actorDiscordId: text('actor_discord_id').notNull(),
  actorName: text('actor_name').notNull(),
  businessId: text('business_id'),
  action: text('action').notNull(),
  targetType: text('target_type'),
  targetId: text('target_id'),
  details: jsonb('details').$type<Record<string, unknown>>(),
  success: boolean('success').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  // Audit reads scan by business or actor, ordered newest-first.
  index('idx_audit_biz_created').on(table.businessId, table.createdAt.desc()),
  index('idx_audit_actor_created').on(table.actorDiscordId, table.createdAt.desc()),
])

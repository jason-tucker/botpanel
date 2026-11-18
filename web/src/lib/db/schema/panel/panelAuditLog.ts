/**
 * Panel-owned `panel_audit_log` table — durable audit for Squishy-side
 * panel events that have no home in the bot's `setting_changes` (sudo,
 * push, color roles, auth events, View-As, failed setting attempts, ...).
 *
 * Hand-authored, NOT vendored. DDL: `src/lib/db/migrations/0002_panel_audit_log.sql`,
 * also created lazily by `ensurePanelAuditTable()` (`src/lib/db/panelAudit.ts`).
 * Lives in the Squishy Postgres next to `panel_sessions` and `push_subscriptions`.
 */
import {
  pgTable,
  bigserial,
  timestamp,
  text,
  boolean,
  jsonb,
  index,
} from 'drizzle-orm/pg-core'

export const panelAuditLog = pgTable(
  'panel_audit_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    action: text('action').notNull(),
    actorUserId: text('actor_user_id').notNull(),
    actorName: text('actor_name'),
    // NULL when equal to the actor (View-As off).
    viewingUserId: text('viewing_user_id'),
    targetType: text('target_type'),
    targetId: text('target_id'),
    success: boolean('success').notNull(),
    errorMessage: text('error_message'),
    before: jsonb('before'),
    after: jsonb('after'),
    ipHash: text('ip_hash'),
    uaHash: text('ua_hash'),
  },
  (t) => ({
    createdAtIdx: index('panel_audit_log_created_at_idx').on(t.createdAt.desc()),
    actorIdx: index('panel_audit_log_actor_idx').on(t.actorUserId),
  }),
)

export type PanelAuditLogRow = typeof panelAuditLog.$inferSelect
export type NewPanelAuditLogRow = typeof panelAuditLog.$inferInsert

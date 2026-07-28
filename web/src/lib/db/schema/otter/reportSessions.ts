// AUTO-GENERATED — DO NOT EDIT. Run scripts/sync-schema.sh in botpanel repo.
import { pgTable, text, timestamp, jsonb, index } from 'drizzle-orm/pg-core'

// DB-backed /report review session — survives bot restarts unlike the old
// in-memory Map. Keyed by random hex (set via createReportSession). Rows
// expire by `expiresAt` (7 days — owner review can take days) and are swept
// on every insert; explicit lookups also bail past the expiry.
export const reportSessions = pgTable('report_sessions', {
  key: text('key').primaryKey(),
  reporterId: text('reporter_id').notNull(),
  reporterTag: text('reporter_tag').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  labels: jsonb('labels').notNull().default([]),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  expiresAt: timestamp('expires_at').notNull(),
}, (table) => [
  // Sweep on insert deletes WHERE expires_at < now(). Without this it becomes
  // a seqscan that grows with every session ever created.
  index('idx_report_sessions_expires').on(table.expiresAt),
])

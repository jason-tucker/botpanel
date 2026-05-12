// AUTO-GENERATED — DO NOT EDIT. Run scripts/sync-schema.sh in botpanel repo.
import { pgTable, text, uuid, timestamp, index } from 'drizzle-orm/pg-core'

// DB-backed lookup session — survives bot restarts unlike the in-memory Map.
// Keyed by random hex (set via storeLookupSession). Rows expire by `expiresAt`
// and are swept on every store; explicit lookups also bail past the expiry.
export const lookupSessions = pgTable('lookup_sessions', {
  key: text('key').primaryKey(),
  characterId: text('character_id').notNull(),
  characterName: text('character_name').notNull(),
  characterCsn: text('character_csn'), // nullable — required for MKE API marker fetches
  businessId: uuid('business_id').notNull(),
  targetDiscordId: text('target_discord_id'),
  rank: text('rank').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  // Sweep on insert deletes WHERE expires_at < now(). Without this it becomes
  // a seqscan that grows with every session ever created.
  index('idx_lookup_sessions_expires').on(table.expiresAt),
])

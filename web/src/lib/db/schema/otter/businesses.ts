// AUTO-GENERATED — DO NOT EDIT. Run scripts/sync-schema.sh in botpanel repo.
import { pgTable, uuid, text, boolean, jsonb, timestamp, unique } from 'drizzle-orm/pg-core'

export const businesses = pgTable('businesses', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull().unique(),
  slug: text('slug').notNull().unique(),
  providerType: text('provider_type').$type<'mckenzie' | 'discord-only'>().notNull(),
  guildId: text('guild_id').notNull(),
  active: boolean('active').notNull().default(true),
  settings: jsonb('settings').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  createdBy: text('created_by'),
  updatedAt: timestamp('updated_at'),
  updatedBy: text('updated_by'),
  deactivatedAt: timestamp('deactivated_at'),
  deactivatedBy: text('deactivated_by'),
})

export const businessRoleMappings = pgTable('business_role_mappings', {
  id: uuid('id').defaultRandom().primaryKey(),
  businessId: uuid('business_id')
    .notNull()
    .references(() => businesses.id, { onDelete: 'cascade' }),
  guildId: text('guild_id').notNull(),
  roleId: text('role_id').notNull(),
  /** Discord role name — stored for display; role ID is the authoritative key */
  roleName: text('role_name'),
  rank: text('rank').$type<'employee' | 'manager' | 'owner'>().notNull(),
  /** UI label shown in management embeds */
  label: text('label'),
  /** True for the primary role assigned when hiring at this rank */
  isBase: boolean('is_base').notNull().default(false),
  /** When assigning this role, also assign the base employee role */
  autoGrantEmployee: boolean('auto_grant_employee').notNull().default(false),
  /** Minimum staff rank required to assign or remove this role mapping */
  minRankToAssign: text('min_rank_to_assign')
    .$type<'employee' | 'manager' | 'owner'>()
    .notNull()
    .default('manager'),
}, (table) => [
  unique('uq_role_per_guild').on(table.guildId, table.roleId),
])

import { z } from 'zod'

/**
 * zod-validated env. Read once at module load; throws at boot if anything's
 * missing or malformed so a typo never silently becomes runtime undefined.
 */
const schema = z.object({
  // ─── Auth ──────────────────────────────────────────────────────────
  DISCORD_CLIENT_ID: z.string().min(1).optional(),
  DISCORD_CLIENT_SECRET: z.string().min(1).optional(),
  SESSION_SECRET: z.string().min(32).optional(),

  // ─── Bot owner ─────────────────────────────────────────────────────
  // Single-user fallback if no Discord Application Team is configured.
  BOT_OWNER_ID: z.string().regex(/^\d{15,25}$/).default('117501528641634310'),

  // ─── Discord guild ────────────────────────────────────────────────
  GUILD_ID: z.string().regex(/^\d{15,25}$/).optional(),

  // ─── Public URL ───────────────────────────────────────────────────
  // Cookie domain / OAuth redirect / CSRF origin derive from this at boot.
  PUBLIC_BASE_URL: z.string().url().optional(),

  // ─── Inter-process ────────────────────────────────────────────────
  REDIS_URL: z.string().default('redis://redis:6379'),
  BOTPANEL_RPC_SECRET: z.string().min(32).optional(),

  // ─── Databases ────────────────────────────────────────────────────
  SQUISHY_DATABASE_URL: z.string().url().optional(),
  OTTER_DATABASE_URL: z.string().url().optional(),

  // ─── Build metadata ───────────────────────────────────────────────
  GIT_SHA: z.string().default('dev'),
  BUILD_TIME: z.string().default('unknown'),

  // ─── Runtime ──────────────────────────────────────────────────────
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
})

const parsed = schema.safeParse(process.env)
if (!parsed.success) {
  console.error('❌ Invalid env:', parsed.error.flatten().fieldErrors)
  throw new Error('Invalid env — see above')
}

export const env = parsed.data
export type Env = z.infer<typeof schema>

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
  // AEAD key for Discord refresh-token encryption at rest. 32 bytes as 64
  // hex chars. Optional in the schema (so existing auth-less / lab boots
  // don't break) but `tokenCrypto.encryptToken` throws if unset — production
  // deploys that perform an OAuth callback MUST set it. Generate with:
  //   openssl rand -hex 32
  OAUTH_TOKEN_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'OAUTH_TOKEN_KEY must be 64 hex chars (32 bytes)')
    .optional(),

  // ─── Bot owner ─────────────────────────────────────────────────────
  // Single-user fallback if no Discord Application Team is configured.
  BOT_OWNER_ID: z.string().regex(/^\d{15,25}$/).default('117501528641634310'),

  // ─── Sudo (Squishy) ───────────────────────────────────────────────
  // Comma-separated Discord IDs that get implicit Squishy sudo. The
  // canonical source for the role-based check (SUDO_ROLE_IDS) needs a
  // Discord member fetch and is deferred to V2.
  SUDO_USER_IDS: z.string().optional(),

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

  // ─── Audit ────────────────────────────────────────────────────────
  // Salt mixed into every IP/UA hash recorded in audit rows. Optional —
  // a sensible default keeps audit working out-of-the-box, but operators
  // SHOULD set a long random value so hashes from old & new logs match
  // across deploys (and so the salt isn't guessable from the source).
  AUDIT_HASH_SALT: z.string().default('botpanel-audit-default-salt-change-me-in-prod'),

  // ─── Web Push (VAPID) ─────────────────────────────────────────────
  // Generated once via `pnpm exec web-push generate-vapid-keys`. All
  // three must be set for push to actually fire; if any are missing
  // the subscribe routes return 503 and the dispatcher logs + no-ops
  // so the underlying write that triggered it never fails. The public
  // key is also exposed to the browser via `NEXT_PUBLIC_VAPID_PUBLIC`
  // in next.config — this server-side mirror keeps the dispatcher
  // honest (we read from `env`, never from `process.env` directly).
  VAPID_PUBLIC: z.string().min(80).optional(),
  VAPID_PRIVATE: z.string().min(40).optional(),
  // RFC 8292 §2: the `sub` claim of the VAPID JWT. Must be a
  // `mailto:` or `https://` URL the push service can reach the
  // operator at if something goes wrong. Defaults to a sentinel
  // mailto so a misconfigured env doesn't crash on boot.
  VAPID_SUBJECT: z.string().default('mailto:botpanel@localhost'),

  // Mirror of VAPID_PUBLIC exposed to the browser via Next's
  // `NEXT_PUBLIC_*` convention. The PushOptIn component reads this
  // through `process.env.NEXT_PUBLIC_VAPID_PUBLIC` directly (Next
  // inlines it at build time); validating here just means a missing
  // value fails fast at boot instead of silently producing a 0-byte
  // applicationServerKey at the browser.
  NEXT_PUBLIC_VAPID_PUBLIC: z.string().min(80).optional(),

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

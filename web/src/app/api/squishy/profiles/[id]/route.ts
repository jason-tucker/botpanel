/**
 * PATCH /api/squishy/profiles/[id] — partial update of a user_profiles row.
 *
 * Two schemas, chosen in-handler from `access`:
 *  - Sudo (squishy.sudo || botOwner) → full schema: any field including the
 *    staff.* fields (`staffCategory`, `department`, `tier`, `leadershipTitle`).
 *  - Self-service (id === access.viewing.id, no sudo) → restricted schema:
 *    name + birthday fields only. Staff fields are sudo-only — convention
 *    from squishybot/CLAUDE.md ("every per-user setting must be sudo-editable
 *    on behalf of users").
 *  - Non-sudo trying to edit someone else's profile → 403.
 *
 * Because the gating depends on comparing the URL `id` against the viewer's
 * own ID, `withAuth` only enforces "logged in" (`require: 'any'`); the
 * sudo-vs-self gate is hand-rolled inside the handler.
 *
 * Profile rows may not exist yet — the bot creates them lazily on first
 * `/profile` use. We INSERT … ON CONFLICT(guild_id, user_id) DO UPDATE so
 * the first edit creates the row, every subsequent edit patches it. The
 * unique index lives on the (guildId, userId) pair (`user_profiles_guild_user_uq`).
 *
 * Audit: writes BOTH success and failure as `action: 'profile.updated'`,
 * `targetType: 'user_profiles'`, `targetId: id` (the Discord user id), with
 * `before`/`after` snapshots.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { withAuth } from '@/lib/auth/middleware'
import { writeAudit } from '@/lib/audit'
import { squishyDb, squishySchema } from '@/lib/db/squishy'
import { env } from '@/lib/env'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteCtx = { params: Promise<{ id: string }> }

// Caps mirror the column types in the vendored schema (text without explicit
// limits) but keep payloads sane. The bot itself enforces nothing on these
// columns, so the dashboard is the authoritative limit for web-side writes.
const DISPLAY_NAME_MAX = 80
const REAL_NAME_MAX = 80
const LEADERSHIP_TITLE_MAX = 120
const DEPARTMENT_MAX = 80
const TIER_MAX = 80
const STAFF_CATEGORY_MAX = 60

// Reusable transforms. `nullableTrimmedString(max)` accepts `null`, omitted,
// or a string — trims, and treats the empty string as a clear (→ null).
function nullableTrimmedString(max: number) {
  return z
    .union([z.string(), z.null()])
    .optional()
    .transform((v) => {
      if (v === undefined) return undefined
      if (v === null) return null
      const trimmed = v.trim()
      return trimmed.length === 0 ? null : trimmed
    })
    .refine(
      (v) => v === undefined || v === null || v.length <= max,
      { message: `must be <= ${max} chars` },
    )
}

// Birthday parts accept null (clear) or an int in range.
const birthdayMonth = z
  .union([z.number().int().min(1).max(12), z.null()])
  .optional()
const birthdayDay = z
  .union([z.number().int().min(1).max(31), z.null()])
  .optional()
const birthdayYear = z
  .union([z.number().int().min(1900).max(9999), z.null()])
  .optional()

// Booleans — required boolean if present, no transform.
const optionalBool = z.boolean().optional()

// Self-service: name + birthday fields ONLY.
const selfSchema = z.object({
  realName: nullableTrimmedString(REAL_NAME_MAX),
  displayName: nullableTrimmedString(DISPLAY_NAME_MAX),
  birthdayMonth,
  birthdayDay,
  birthdayYear,
  birthdayPingsEnabled: optionalBool,
  birthdayYearVisible: optionalBool,
})

// Sudo: self fields + staff.* fields.
const sudoSchema = selfSchema.extend({
  staffCategory: nullableTrimmedString(STAFF_CATEGORY_MAX),
  department: nullableTrimmedString(DEPARTMENT_MAX),
  tier: nullableTrimmedString(TIER_MAX),
  leadershipTitle: nullableTrimmedString(LEADERSHIP_TITLE_MAX),
})

type ProfileSnapshot = {
  realName: string | null
  displayName: string | null
  birthdayMonth: number | null
  birthdayDay: number | null
  birthdayYear: number | null
  birthdayPingsEnabled: boolean
  birthdayYearVisible: boolean
  staffCategory: string | null
  department: string | null
  tier: string | null
  leadershipTitle: string | null
}

function rowToSnapshot(r: typeof squishySchema.userProfiles.$inferSelect): ProfileSnapshot {
  return {
    realName: r.realName,
    displayName: r.displayName,
    birthdayMonth: r.birthdayMonth,
    birthdayDay: r.birthdayDay,
    birthdayYear: r.birthdayYear,
    birthdayPingsEnabled: r.birthdayPingsEnabled,
    birthdayYearVisible: r.birthdayYearVisible,
    staffCategory: r.staffCategory,
    department: r.department,
    tier: r.tier,
    leadershipTitle: r.leadershipTitle,
  }
}

async function readExisting(
  guildId: string,
  userId: string,
): Promise<typeof squishySchema.userProfiles.$inferSelect | null> {
  try {
    const rows = await squishyDb
      .select()
      .from(squishySchema.userProfiles)
      .where(
        and(
          eq(squishySchema.userProfiles.guildId, guildId),
          eq(squishySchema.userProfiles.userId, userId),
        ),
      )
      .limit(1)
    return rows[0] ?? null
  } catch (err) {
    console.warn('[squishy/profiles PATCH] read-before-write failed', err)
    return null
  }
}

const SNOWFLAKE_RE = /^\d{15,25}$/

export const PATCH = withAuth<[RouteCtx]>(
  async (req: NextRequest, access, ctx) => {
    const { id } = await ctx.params

    if (!id || !SNOWFLAKE_RE.test(id)) {
      return NextResponse.json(
        { error: 'id must be a Discord snowflake (15-25 digits)' },
        { status: 400 },
      )
    }

    const isSudo = access.botOwner || access.squishy.sudo
    const isSelf = access.viewing.id === id

    // Non-sudo trying to edit someone else's profile → 403. Self-service is
    // strictly viewer-edits-own-row.
    if (!isSudo && !isSelf) {
      await writeAudit({
        bot: 'squishy',
        action: 'profile.updated',
        targetType: 'user_profiles',
        targetId: id,
        actor: access.actor,
        viewing: access.viewing,
        before: null,
        after: null,
        success: false,
        errorMessage: 'forbidden-not-self-and-not-sudo',
      }).catch(() => {})
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }

    if (!env.GUILD_ID) {
      await writeAudit({
        bot: 'squishy',
        action: 'profile.updated',
        targetType: 'user_profiles',
        targetId: id,
        actor: access.actor,
        viewing: access.viewing,
        before: null,
        after: null,
        success: false,
        errorMessage: 'GUILD_ID-unset',
      }).catch(() => {})
      return NextResponse.json(
        { error: 'GUILD_ID is not configured' },
        { status: 500 },
      )
    }

    let body: unknown
    try {
      body = await req.json()
    } catch {
      await writeAudit({
        bot: 'squishy',
        action: 'profile.updated',
        targetType: 'user_profiles',
        targetId: id,
        actor: access.actor,
        viewing: access.viewing,
        before: null,
        after: null,
        success: false,
        errorMessage: 'invalid-json',
      }).catch(() => {})
      return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
    }

    // Coerce stringy form values (some browsers post numbers as strings even
    // through ServerForm's JSON mode because every <input> value is a string)
    // into the right types BEFORE schema validation. We don't want to make
    // the schema accept strings everywhere — the API contract should be
    // typed — so we do the lift here as a courtesy to the form caller.
    const coerced = coerceProfilePatch(body)

    const schema = isSudo ? sudoSchema : selfSchema
    let parsed: z.infer<typeof sudoSchema>
    try {
      parsed = schema.parse(coerced) as z.infer<typeof sudoSchema>
    } catch (err) {
      const details = err instanceof z.ZodError ? err.issues : 'invalid body'
      await writeAudit({
        bot: 'squishy',
        action: 'profile.updated',
        targetType: 'user_profiles',
        targetId: id,
        actor: access.actor,
        viewing: access.viewing,
        before: null,
        after: null,
        success: false,
        errorMessage: 'validation-failed',
      }).catch(() => {})
      return NextResponse.json({ error: 'invalid', details }, { status: 400 })
    }

    // If a self-service caller smuggled staff.* fields in the body, the
    // `selfSchema.parse()` will have silently stripped them (zod default for
    // unknown keys is "strip"). That's the right behavior — the request
    // succeeds for the legal fields and the staff fields are simply ignored.

    const existing = await readExisting(env.GUILD_ID, id)
    const before: ProfileSnapshot | null = existing ? rowToSnapshot(existing) : null

    // Build the UPDATE/INSERT payload from only the fields the caller actually
    // sent (undefined-skip), so re-submitting a tiny patch doesn't clobber
    // unrelated fields.
    const patch: Partial<typeof squishySchema.userProfiles.$inferInsert> = {
      updatedAt: new Date(),
    }
    if (parsed.realName !== undefined) patch.realName = parsed.realName
    if (parsed.displayName !== undefined) patch.displayName = parsed.displayName
    if (parsed.birthdayMonth !== undefined) patch.birthdayMonth = parsed.birthdayMonth
    if (parsed.birthdayDay !== undefined) patch.birthdayDay = parsed.birthdayDay
    if (parsed.birthdayYear !== undefined) patch.birthdayYear = parsed.birthdayYear
    if (parsed.birthdayPingsEnabled !== undefined) patch.birthdayPingsEnabled = parsed.birthdayPingsEnabled
    if (parsed.birthdayYearVisible !== undefined) patch.birthdayYearVisible = parsed.birthdayYearVisible
    if (isSudo) {
      if (parsed.staffCategory !== undefined) patch.staffCategory = parsed.staffCategory
      if (parsed.department !== undefined) patch.department = parsed.department
      if (parsed.tier !== undefined) patch.tier = parsed.tier
      if (parsed.leadershipTitle !== undefined) patch.leadershipTitle = parsed.leadershipTitle
    }

    try {
      // INSERT … ON CONFLICT(guild_id, user_id) DO UPDATE: creates the row
      // on first edit, patches it on every subsequent edit. The unique
      // index in the vendored schema (`user_profiles_guild_user_uq`) covers
      // the (guildId, userId) pair, so this is safe even under races.
      const [updated] = await squishyDb
        .insert(squishySchema.userProfiles)
        .values({
          guildId: env.GUILD_ID,
          userId: id,
          // For the insert path, defaults on the columns kick in for anything
          // not explicitly set in `patch` — booleans default true/false per
          // the schema, every other column is nullable.
          ...patch,
        })
        .onConflictDoUpdate({
          target: [
            squishySchema.userProfiles.guildId,
            squishySchema.userProfiles.userId,
          ],
          set: patch,
        })
        .returning()

      const after = updated ? rowToSnapshot(updated) : null

      await writeAudit({
        bot: 'squishy',
        action: 'profile.updated',
        targetType: 'user_profiles',
        targetId: id,
        actor: access.actor,
        viewing: access.viewing,
        before,
        after,
        success: true,
      }).catch((err) => {
        console.warn('[squishy/profiles PATCH] audit write failed (write succeeded)', err)
      })

      return NextResponse.json({ success: true, profile: after })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown'
      console.error('[squishy/profiles PATCH] DB write failed', err)
      await writeAudit({
        bot: 'squishy',
        action: 'profile.updated',
        targetType: 'user_profiles',
        targetId: id,
        actor: access.actor,
        viewing: access.viewing,
        before,
        after: patch,
        success: false,
        errorMessage: msg,
      }).catch(() => {})
      return NextResponse.json({ error: 'db-write-failed' }, { status: 503 })
    }
  },
  {
    require: 'any',
    csrf: true,
    rateLimit: { points: 30, perSeconds: 60 },
  },
)

/**
 * The dashboard form posts JSON but every <input> value reaches us as a
 * string regardless of the input type. Lift numeric + boolean fields to
 * their real types here so the zod schemas can stay strict. Pass-through
 * for anything we don't recognize.
 */
function coerceProfilePatch(body: unknown): unknown {
  if (!body || typeof body !== 'object') return body
  const src = body as Record<string, unknown>
  const out: Record<string, unknown> = { ...src }

  for (const k of ['birthdayMonth', 'birthdayDay', 'birthdayYear'] as const) {
    if (out[k] === '' || out[k] === undefined) {
      // Empty string from the form means "clear" → null.
      if (k in out) out[k] = null
      continue
    }
    if (typeof out[k] === 'string') {
      const n = Number(out[k])
      out[k] = Number.isFinite(n) ? n : out[k]
    }
  }

  for (const k of ['birthdayPingsEnabled', 'birthdayYearVisible'] as const) {
    if (out[k] === undefined) continue
    if (typeof out[k] === 'string') {
      // Checkboxes typically come through as 'on' / 'true' / '1' (or absent
      // entirely when unchecked). We treat absence as undefined (don't touch),
      // and any non-falsy string as true.
      const v = (out[k] as string).toLowerCase()
      out[k] = v === 'true' || v === 'on' || v === '1' || v === 'yes'
    } else if (typeof out[k] !== 'boolean') {
      out[k] = Boolean(out[k])
    }
  }

  // String fields: trim and treat '' as 'clear' (null). The schema also
  // normalizes this, but doing it here keeps the audit `after` legible.
  for (const k of [
    'realName',
    'displayName',
    'staffCategory',
    'department',
    'tier',
    'leadershipTitle',
  ] as const) {
    if (out[k] === undefined) continue
    if (out[k] === null) continue
    if (typeof out[k] === 'string') {
      const trimmed = (out[k] as string).trim()
      out[k] = trimmed.length === 0 ? null : trimmed
    }
  }

  return out
}

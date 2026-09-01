/**
 * Configurable access control for the panel's OC Stock surface
 * (`/otter/oc-stock` + `/api/otter/oc-stock/**`).
 *
 * ── Why ──────────────────────────────────────────────────────────────
 * Access used to be hard-coded in five places: "any signed-in user can
 * see the board, owner/manager of `original-clothing` (or the bot owner)
 * can edit it". That's the right default but not the right ceiling — OC
 * wanted specific Discord roles to be able to edit without being promoted
 * to manager, and wanted the option to hide the board from non-staff.
 *
 * The rule set now lives in the Otter DB on the `original-clothing`
 * business row, under `settings.ocStockAccess`. It is a JSONB blob rather
 * than new columns because the table is owned by the bot repo (schema
 * changes there are a cross-repo PR, see CLAUDE.md "Schema sync") and
 * because the shape is panel-specific.
 *
 * ── Shape ────────────────────────────────────────────────────────────
 *   settings.ocStockAccess = {
 *     view: { minRank: 'anyone'|'employee'|'manager'|'owner', roleIds: [] },
 *     edit: { minRank: 'anyone'|'employee'|'manager'|'owner', roleIds: [] },
 *   }
 *
 * `minRank` is the LOWEST OC business rank that satisfies the rule;
 * `'anyone'` means every signed-in panel user. `roleIds` is an additional
 * OR-ed allowlist of raw Discord role snowflakes — a user holding any of
 * them passes the rule regardless of rank. The two are additive, never
 * subtractive: you can only widen a rank rule with roles, never narrow it.
 *
 * Missing / malformed config falls back to `DEFAULT_OC_STOCK_ACCESS`,
 * which reproduces the pre-config behaviour exactly (view: anyone, edit:
 * manager+). A corrupt blob therefore degrades to the old rules rather
 * than locking everyone out.
 *
 * ── Escape hatches (deliberate, do not remove) ────────────────────────
 * The bot owner and any OC business *owner* always pass BOTH rules, no
 * matter what the config says. Without that, one bad save could lock the
 * only people who can fix it out of the page that fixes it. Only the bot
 * owner and OC owners may change the config at all — managers can't widen
 * their own access, mirroring the role-mappings route's gate.
 *
 * ── Freshness ────────────────────────────────────────────────────────
 * Reads are memoized for 30 s in-process (the board is polled on every
 * render of a `force-dynamic` page). Writes bust the cache immediately in
 * the writing process; other panel replicas pick the change up within the
 * TTL. `businesses.settings` is not cached bot-side for OC, so no
 * `publishInvalidate` is strictly required — we send one anyway so a
 * future bot-side reader gets the same treatment as `business_messages`.
 */
import { eq } from 'drizzle-orm'
import { otterDb } from '@/lib/db/otter'
import { businesses } from '@/lib/db/schema/otter/businesses'
import type { AccessMap, BusinessRank } from '@/lib/auth/perms'

/** The one business this surface is about. */
export const OC_SLUG = 'original-clothing'

/** Key inside `businesses.settings` that holds the rule set. */
export const OC_ACCESS_SETTINGS_KEY = 'ocStockAccess'

export type MinRank = 'anyone' | BusinessRank
export type OcAccessRule = { minRank: MinRank; roleIds: string[] }
export type OcStockAccessConfig = { view: OcAccessRule; edit: OcAccessRule }

export const MIN_RANK_VALUES = ['anyone', 'employee', 'manager', 'owner'] as const satisfies readonly MinRank[]

/** Pre-config behaviour, and the fallback for a missing/corrupt blob. */
export const DEFAULT_OC_STOCK_ACCESS: OcStockAccessConfig = {
  view: { minRank: 'anyone', roleIds: [] },
  edit: { minRank: 'manager', roleIds: [] },
}

// Higher number = more privileged. `anyone` sits below every real rank so
// `rankAtLeast(rank, 'anyone')` is true for a user with no rank at all.
const RANK_WEIGHT: Record<MinRank, number> = {
  anyone: 0,
  employee: 1,
  manager: 2,
  owner: 3,
}

const SNOWFLAKE_RE = /^\d{15,25}$/

function isMinRank(v: unknown): v is MinRank {
  return typeof v === 'string' && (MIN_RANK_VALUES as readonly string[]).includes(v)
}

function parseRule(raw: unknown, fallback: OcAccessRule): OcAccessRule {
  if (!raw || typeof raw !== 'object') return fallback
  const o = raw as { minRank?: unknown; roleIds?: unknown }
  const minRank = isMinRank(o.minRank) ? o.minRank : fallback.minRank
  const roleIds = Array.isArray(o.roleIds)
    ? [...new Set(o.roleIds.filter((r): r is string => typeof r === 'string' && SNOWFLAKE_RE.test(r)))]
    : fallback.roleIds
  return { minRank, roleIds }
}

/**
 * Normalize whatever is sitting in `businesses.settings` into a complete
 * config. Never throws — an operator hand-editing the JSONB into nonsense
 * gets the defaults, not a 500.
 */
export function parseOcStockAccess(settings: unknown): OcStockAccessConfig {
  if (!settings || typeof settings !== 'object') return DEFAULT_OC_STOCK_ACCESS
  const raw = (settings as Record<string, unknown>)[OC_ACCESS_SETTINGS_KEY]
  if (!raw || typeof raw !== 'object') return DEFAULT_OC_STOCK_ACCESS
  const o = raw as { view?: unknown; edit?: unknown }
  return {
    view: parseRule(o.view, DEFAULT_OC_STOCK_ACCESS.view),
    edit: parseRule(o.edit, DEFAULT_OC_STOCK_ACCESS.edit),
  }
}

// ── Read path ──────────────────────────────────────────────────────────

type CacheEntry = { config: OcStockAccessConfig; expiresAt: number }
const CONFIG_TTL_MS = 30_000
let cached: CacheEntry | null = null

/** Drop the memo so the next read hits Postgres. Called after a save. */
export function invalidateOcStockAccessCache(): void {
  cached = null
}

/**
 * Load the effective rule set. A downed Otter Postgres yields the
 * defaults — same posture as the rest of the page, which degrades to
 * "stock unavailable" rather than 500-ing.
 */
export async function loadOcStockAccess(): Promise<OcStockAccessConfig> {
  const now = Date.now()
  if (cached && cached.expiresAt > now) return cached.config
  try {
    const [row] = await otterDb
      .select({ settings: businesses.settings })
      .from(businesses)
      .where(eq(businesses.slug, OC_SLUG))
      .limit(1)
    const config = parseOcStockAccess(row?.settings)
    cached = { config, expiresAt: now + CONFIG_TTL_MS }
    return config
  } catch (err) {
    console.warn('[oc-stock-access] settings read failed; using defaults', err)
    return DEFAULT_OC_STOCK_ACCESS
  }
}

// ── Evaluation ─────────────────────────────────────────────────────────

export type OcStockCapabilities = {
  canView: boolean
  canEdit: boolean
  /** May change the rule set itself (bot owner or OC business owner). */
  canConfigure: boolean
  /**
   * True when the viewer holds no OC rank at all and got in purely through
   * the Discord-role allowlist. The dashboard nav uses this to surface an
   * Otter section for someone who is otherwise not Otter staff — without
   * it, an operator could grant a role access to a page the grantee can
   * never find a link to.
   */
  grantedByRole: boolean
}

function rankAllows(rule: OcAccessRule, rank: BusinessRank | undefined): boolean {
  const weight = rank ? RANK_WEIGHT[rank] : RANK_WEIGHT.anyone
  return weight >= RANK_WEIGHT[rule.minRank]
}

function roleAllows(rule: OcAccessRule, roleIds: string[]): boolean {
  if (rule.roleIds.length === 0) return false
  return roleIds.some((r) => rule.roleIds.includes(r))
}

function ruleAllows(rule: OcAccessRule, rank: BusinessRank | undefined, roleIds: string[]): boolean {
  return rankAllows(rule, rank) || roleAllows(rule, roleIds)
}

/**
 * Resolve the viewer's OC-stock capabilities against a rule set.
 *
 * Under View-As this reads `access.otter` / `access.botOwner`, which
 * `resolveAccess()` has already swapped to the *viewed* user — so an
 * impersonating sudo sees exactly what their subject would see.
 */
export function evaluateOcStockAccess(
  access: AccessMap,
  config: OcStockAccessConfig,
): OcStockCapabilities {
  const rank = access.otter.businesses[OC_SLUG]
  const roleIds = access.otter.roleIds ?? []

  // Never lock out the people who can unlock it (see file header).
  const alwaysAllowed = access.botOwner || rank === 'owner'
  if (alwaysAllowed) {
    return { canView: true, canEdit: true, canConfigure: true, grantedByRole: false }
  }

  const canView = ruleAllows(config.view, rank, roleIds)
  // Editing implies viewing: a rule set that grants edit but not view is
  // incoherent, and silently allowing a blind edit is worse than widening
  // the view for that user.
  const canEdit = ruleAllows(config.edit, rank, roleIds)
  const grantedByRole =
    rank === undefined &&
    (roleAllows(config.view, roleIds) || roleAllows(config.edit, roleIds))
  return { canView: canView || canEdit, canEdit, canConfigure: false, grantedByRole }
}

/** Convenience: load + evaluate in one call. */
export async function resolveOcStockAccess(access: AccessMap): Promise<OcStockCapabilities> {
  return evaluateOcStockAccess(access, await loadOcStockAccess())
}

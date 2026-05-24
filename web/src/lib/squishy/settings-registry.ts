/**
 * NUMERIC_SETTINGS — panel-side mirror of the bot's numeric `bot_settings`
 * registry. Each entry pins a `bot_settings.key` to a numeric range so the
 * generic `PUT /api/squishy/settings/[key]` write boundary can reject garbage
 * (e.g. `"hello"`, `"-1"`, `"999999"`) before it ever lands in the DB.
 *
 * Source of truth (bot side):
 *   squishybot/src/interactions/sudoSettings.ts → const NUMERIC_SETTINGS
 *
 * Keep this list in sync with the bot. Drift is a SECURITY bug (#237): the
 * bot will silently clamp/fallback at read-time but the panel write boundary
 * is the higher-volume operator UX, so the defense-in-depth value lives on
 * this side. If you add a numeric setting in squishybot's NUMERIC_SETTINGS,
 * mirror it here in the SAME PR (grep for "NUMERIC_SETTINGS" in both repos).
 *
 * Not a Drizzle schema → not vendored by scripts/sync-schema.sh. Hand-mirror.
 */

export interface NumericSettingBound {
  /** Dotted bot_settings key (e.g. `voice.cleanup_delay_ms`). */
  key: string
  /** Inclusive lower bound. Omit for no lower bound. */
  min?: number
  /** Inclusive upper bound. Omit for no upper bound. */
  max?: number
}

/**
 * Mirror of squishybot's NUMERIC_SETTINGS const at
 * `squishybot/src/interactions/sudoSettings.ts:103`.
 *
 * Only `key` + `min` + `max` are mirrored here — labels, descriptions, and
 * env fallbacks are bot-only concerns. The panel only needs the bounds to
 * reject out-of-range writes.
 */
export const NUMERIC_SETTINGS: readonly NumericSettingBound[] = [
  { key: 'voice.cleanup_delay_ms', min: 0, max: 600000 },
  { key: 'voice.owner_grace_ms', min: 0, max: 3600000 },
] as const

const NUMERIC_KEY_INDEX: ReadonlyMap<string, NumericSettingBound> = new Map(
  NUMERIC_SETTINGS.map((def) => [def.key, def]),
)

/** Returns the numeric bounds for a key, or `null` if the key is not numeric. */
export function getNumericBound(key: string): NumericSettingBound | null {
  return NUMERIC_KEY_INDEX.get(key) ?? null
}

/**
 * Validate a stringified numeric value against the registry.
 *
 * - Returns `null` if `key` is not a registered numeric setting (caller
 *   should fall through to its normal string-value validation).
 * - Returns `null` if `value` parses as a finite number within the bounds.
 * - Returns an error message string if the value is non-numeric, NaN, ±Inf,
 *   or out of range.
 */
export function validateNumericSetting(
  key: string,
  value: string,
): string | null {
  const def = getNumericBound(key)
  if (!def) return null

  const trimmed = value.trim()
  if (trimmed.length === 0) return 'value must be a non-empty number'

  const n = Number(trimmed)
  if (!Number.isFinite(n)) return `value must be a finite number for ${key}`

  if (def.min !== undefined && n < def.min) {
    return `value must be >= ${def.min} for ${key}`
  }
  if (def.max !== undefined && n > def.max) {
    return `value must be <= ${def.max} for ${key}`
  }
  return null
}

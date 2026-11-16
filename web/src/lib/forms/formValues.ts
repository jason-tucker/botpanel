/**
 * Parsers for values posted by `<ServerForm>`. Its JSON mode sends every
 * field as a string (FormData has no other type), so booleans arrive as
 * "true" / "false" and number inputs as "" or "5". These helpers accept
 * both the typed and the string form, and nothing looser.
 *
 * Do NOT use `z.coerce.boolean()` for this: it turns "false" into true.
 */
import { z } from 'zod'

/** true / "true" → true, false / "false" → false, anything else → undefined. */
export function parseFormBoolean(v: unknown): boolean | undefined {
  if (v === true || v === 'true') return true
  if (v === false || v === 'false') return false
  return undefined
}

/** zod boolean that also accepts the strings "true" / "false". */
export const formBoolean = z.preprocess(
  (v) => parseFormBoolean(v) ?? v,
  z.boolean(),
)

/**
 * Optional integer field. Absent, null and "" (an empty number input) mean
 * "not supplied" (`value: null`); an integer or an integer string is
 * converted; anything else is rejected.
 */
export function parseOptionalInt(
  v: unknown,
): { ok: true; value: number | null } | { ok: false } {
  if (v === undefined || v === null) return { ok: true, value: null }
  if (typeof v === 'number') {
    return Number.isSafeInteger(v) ? { ok: true, value: v } : { ok: false }
  }
  if (typeof v === 'string') {
    const t = v.trim()
    if (t === '') return { ok: true, value: null }
    if (!/^-?\d+$/.test(t)) return { ok: false }
    const n = Number(t)
    return Number.isSafeInteger(n) ? { ok: true, value: n } : { ok: false }
  }
  return { ok: false }
}

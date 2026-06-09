/**
 * `cn` — the tiny classnames helper the whole UI kit shares.
 *
 * We deliberately don't pull in `clsx` + `tailwind-merge` as deps: the panel
 * keeps its dependency surface small (see package.json), and our class
 * composition never actually needs Tailwind conflict-resolution because the
 * variant maps below own their own class sets. This supports the common
 * shapes — strings, arrays, and `{ 'class': boolean }` objects — and flattens
 * them into a single space-joined string. Falsy values are dropped.
 */
export type ClassValue =
  | string
  | number
  | null
  | false
  | undefined
  | ClassValue[]
  | Record<string, boolean | null | undefined>

export function cn(...inputs: ClassValue[]): string {
  const out: string[] = []
  const walk = (v: ClassValue): void => {
    if (v === null || v === undefined || v === false || v === '') return
    if (typeof v === 'string' || typeof v === 'number') {
      out.push(String(v))
      return
    }
    if (Array.isArray(v)) {
      for (const item of v) walk(item)
      return
    }
    if (typeof v === 'object') {
      for (const key of Object.keys(v)) {
        if (v[key]) out.push(key)
      }
    }
  }
  for (const input of inputs) walk(input)
  return out.join(' ')
}

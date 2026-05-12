/**
 * Panel-side mirror of `squishybot/src/services/staffRoles.ts`. The
 * panel doesn't import bot source; duplicating slug + label is the
 * documented trade-off. The bot owns Discord role IDs and colors.
 *
 * Keep this aligned by hand when the bot's list changes. The bot's
 * `staff.request` RPC verb returns structured errors (`unknown-department`
 * / `unknown-tier`) if a slug it doesn't recognize lands, so a drift bug
 * surfaces as a friendly 400 rather than a silent insert.
 *
 * On approval the bot also grants the "IT CRI Staff" base role
 * automatically — that role doesn't appear in this picker since the
 * requester never picks it explicitly.
 */
export type DepartmentSlug = 'help_desk' | 'onsites' | 'security' | 'sales' | 'leadership'
export type TierSlug = 'tier_1' | 'tier_2' | 'tier_3'

export type StaffRoleOption<S extends string = string> = {
  slug: S
  label: string
}

export const DEPARTMENT_OPTIONS: ReadonlyArray<StaffRoleOption<DepartmentSlug>> = [
  { slug: 'help_desk', label: 'Help Desk' },
  { slug: 'onsites', label: 'Onsites' },
  { slug: 'security', label: 'Security' },
  { slug: 'sales', label: 'Sales' },
  { slug: 'leadership', label: 'Leadership' },
]

export const TIER_OPTIONS: ReadonlyArray<StaffRoleOption<TierSlug>> = [
  { slug: 'tier_1', label: 'Tier 1' },
  { slug: 'tier_2', label: 'Tier 2' },
  { slug: 'tier_3', label: 'Tier 3' },
]

export const DEPARTMENT_SLUGS: ReadonlySet<string> = new Set(DEPARTMENT_OPTIONS.map((o) => o.slug))
export const TIER_SLUGS: ReadonlySet<string> = new Set(TIER_OPTIONS.map((o) => o.slug))

export function labelForDepartment(slug: string | null | undefined): string | null {
  if (!slug) return null
  return DEPARTMENT_OPTIONS.find((o) => o.slug === slug)?.label ?? null
}

export function labelForTier(slug: string | null | undefined): string | null {
  if (!slug) return null
  return TIER_OPTIONS.find((o) => o.slug === slug)?.label ?? null
}

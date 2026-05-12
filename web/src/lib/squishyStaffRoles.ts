/**
 * Panel-side mirror of `squishybot/src/services/staffRoles.ts`. The
 * panel doesn't import bot source — duplicating the list (slug +
 * human label only) is the documented trade-off. The bot owns the
 * Discord role IDs and colors; the panel only needs to render the
 * dropdown and round-trip the slug.
 *
 * Keep this aligned by hand when the bot's list changes. The bot's
 * RPC verb (`staff.request`) returns `unknown-role` if a slug it
 * doesn't recognize lands, so a drift bug surfaces as a 400 with a
 * clear error string rather than a silent insert.
 */
export type StaffRoleSlug =
  | 'tier_1'
  | 'tier_2'
  | 'tier_3'
  | 'help_desk'
  | 'onsites'
  | 'security'
  | 'sales'
  | 'leadership'

export type StaffRoleOption = {
  slug: StaffRoleSlug
  label: string
}

export const STAFF_ROLE_OPTIONS: ReadonlyArray<StaffRoleOption> = [
  { slug: 'tier_1', label: 'Tier 1' },
  { slug: 'tier_2', label: 'Tier 2' },
  { slug: 'tier_3', label: 'Tier 3' },
  { slug: 'help_desk', label: 'Help Desk' },
  { slug: 'onsites', label: 'Onsites' },
  { slug: 'security', label: 'Security' },
  { slug: 'sales', label: 'Sales' },
  { slug: 'leadership', label: 'Leadership' },
]

export const STAFF_ROLE_SLUGS: ReadonlySet<string> = new Set(STAFF_ROLE_OPTIONS.map((o) => o.slug))

export function labelForSlug(slug: string): string | null {
  return STAFF_ROLE_OPTIONS.find((o) => o.slug === slug)?.label ?? null
}

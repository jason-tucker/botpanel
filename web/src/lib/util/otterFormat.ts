/**
 * Display helpers for the Otter dashboard pages.
 *
 * Kept dependency-free on purpose — no date-fns / clsx etc. The audit-tail
 * page already hand-rolls `relTime`; we do the same here so a single tree
 * of Otter pages doesn't drag in a formatting library just for pills.
 */

import type { BusinessRank } from '@/lib/auth/perms'

export type Standing = 'good' | 'neutral' | 'bad' | 'blacklisted'

/**
 * Tailwind classes for a rank pill. The "bot-owner" key isn't a real rank —
 * it's the synthetic pill we render when a viewer has no per-business rank
 * but is the global bot owner, so they can still see why they're allowed in.
 */
export function rankColor(rank: BusinessRank | 'bot-owner'): string {
  switch (rank) {
    case 'owner':
      // Gold — primary stakeholder.
      return 'bg-warn/15 text-warn border-warn/30'
    case 'manager':
      // Blue — accent matches the panel's primary brand color.
      return 'bg-accent/15 text-accent border-accent/30'
    case 'employee':
      return 'bg-bg-card2 text-ink-dim border-line'
    case 'bot-owner':
      // Purple-ish — distinct from owner gold and manager blue.
      return 'bg-[#8b5cf6]/15 text-[#c4b5fd] border-[#8b5cf6]/30'
    default:
      return 'bg-bg-card2 text-ink-dim border-line'
  }
}

export function rankLabel(rank: BusinessRank | 'bot-owner'): string {
  switch (rank) {
    case 'owner':
      return 'Owner'
    case 'manager':
      return 'Manager'
    case 'employee':
      return 'Employee'
    case 'bot-owner':
      return 'Bot Owner'
    default:
      return String(rank)
  }
}

export function standingColor(standing: Standing | string): string {
  switch (standing) {
    case 'good':
      return 'bg-ok/15 text-ok border-ok/30'
    case 'neutral':
      return 'bg-bg-card2 text-ink-dim border-line'
    case 'bad':
      return 'bg-warn/15 text-warn border-warn/30'
    case 'blacklisted':
      return 'bg-err/15 text-err border-err/30'
    default:
      return 'bg-bg-card2 text-ink-dim border-line'
  }
}

export function providerColor(provider: string): string {
  switch (provider) {
    case 'mckenzie':
      return 'bg-accent/15 text-accent border-accent/30'
    case 'discord-only':
      return 'bg-bg-card2 text-ink-dim border-line'
    default:
      return 'bg-bg-card2 text-ink-dim border-line'
  }
}

/**
 * Hand-rolled relative timestamp — matches the style used by `AuditLive`.
 * Falls back to the raw ISO string if the input doesn't parse.
 */
export function relTime(iso: string | Date | null | undefined): string {
  if (!iso) return '—'
  const date = iso instanceof Date ? iso : new Date(iso)
  const ms = date.getTime()
  if (!Number.isFinite(ms)) return String(iso)
  const diffSec = Math.round((Date.now() - ms) / 1000)
  if (diffSec < 0) return 'in the future'
  if (diffSec < 5) return 'just now'
  if (diffSec < 60) return `${diffSec}s ago`
  const m = Math.round(diffSec / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  if (d < 30) return `${d}d ago`
  // Past ~a month: ISO date is more useful than a vague "3mo ago".
  return date.toISOString().slice(0, 10)
}

const RANK_ORDER: Record<BusinessRank, number> = {
  owner: 0,
  manager: 1,
  employee: 2,
}

/** Sort role mappings: owner first, manager second, employee third, then by role name. */
export function compareRank(a: BusinessRank, b: BusinessRank): number {
  return (RANK_ORDER[a] ?? 99) - (RANK_ORDER[b] ?? 99)
}

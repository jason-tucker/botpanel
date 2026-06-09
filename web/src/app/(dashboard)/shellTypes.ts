/**
 * Small serializable types shared across the client shell components. Kept
 * separate from `nav.ts` so the rail/topbar/palette can import shapes without
 * pulling the nav builder, and so the server `DashboardShell` and the client
 * `AppFrame` agree on the prop contract.
 */
export type ShellHealthEntry = {
  online: boolean
  version?: string
  uptimeSec?: number
  lastBeatSec?: number
  guildCount?: number
}

/** Keyed by bot name ('squishy' | 'otter'). */
export type ShellHealth = Record<string, ShellHealthEntry>

/** The identity rendered in the rail/topbar — the VIEWED user under View-As. */
export type ShellDisplayUser = {
  id: string
  name: string
  avatarUrl: string | null
  viewAsActive: boolean
}

/** Present only while a View-As session is active. */
export type ShellViewAs = {
  viewingName: string
  actorName: string
} | null

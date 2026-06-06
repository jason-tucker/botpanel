/**
 * User-facing release notes — the source for the sidebar's version badge and
 * its "What's new" dialog (see `(dashboard)/ChangelogButton.tsx`).
 *
 * This is a *curated, plain-language digest* aimed at people using the panel.
 * The exhaustive engineering log lives in `/CHANGELOG.md` at the repo root;
 * keep the two roughly in step, but they are intentionally different in tone
 * and detail.
 *
 * When you cut a release:
 *   1. add a new entry at the TOP of `CHANGELOG` (newest first), and
 *   2. bump `web/package.json`'s `version` to match.
 * `APP_VERSION` is derived from `CHANGELOG[0]`, so the badge tracks the top
 * entry automatically.
 */

export type ChangelogEntry = {
  /** Semver string, no leading "v" (e.g. "0.3.0"). */
  version: string
  /** Release date, ISO `YYYY-MM-DD`. */
  date: string
  /** Short, user-facing bullets — plain text, no markdown. */
  highlights: string[]
}

/** Newest first. `CHANGELOG[0]` is the current release. */
export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '0.3.0',
    date: '2026-06-06',
    highlights: [
      'Game Night scheduler (Squishy → Game Night): design a rich Discord post, then post it now or schedule it for later. RSVP / “own a copy” buttons keep working even after the bot restarts.',
      'New reusable message editor with a live Discord-style preview, a markdown toolbar, dynamic {{variables}}, an accent-colour picker, and a Discord timestamp builder.',
      'Steam links on game-night posts: add a Steam URL and drop {{steam}} anywhere in the post, or use the built-in “🎮 Open in Steam” button (it hides itself when no link is set).',
      'This version badge and “What’s new” changelog, down in the sidebar under Sign out.',
    ],
  },
  {
    version: '0.2.1',
    date: '2026-06-05',
    highlights: [
      'Ops: pinned the auto-update sidecar to a maintained image so production keeps pulling new builds.',
    ],
  },
  {
    version: '0.2.0',
    date: '2026-06-05',
    highlights: [
      'View-As: sudo / owners can browse the panel as another member — every action still audits under your real account.',
      'Web Push notifications for new staff-role requests and bug reports (opt in per browser from /sudo).',
      'Your dashboard (/me) gained quick cards: jump to the voice channel you’re in, and manage which games ping you.',
      'Otter: per-business custom command-button editor. Squishy: a “Post LFG” button on the Games page.',
      'Security: Discord refresh tokens are now encrypted at rest, with an admin “log everyone out” action.',
    ],
  },
  {
    version: '0.1.2',
    date: '2026-06-05',
    highlights: ['Docs: full README and wiki rewrite to match the shipped panel.'],
  },
  {
    version: '0.1.1',
    date: '2026-05-24',
    highlights: ['Security: settings changes now enforce per-key numeric limits.'],
  },
]

/** Current app version, derived from the newest changelog entry. */
export const APP_VERSION = CHANGELOG[0]?.version ?? '0.0.0'

/** `v`-prefixed label for display (e.g. "v0.3.0"). */
export const APP_VERSION_LABEL = `v${APP_VERSION}`

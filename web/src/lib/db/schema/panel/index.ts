/**
 * Panel-owned schemas. Hand-authored (NOT vendored from a bot repo) — these
 * tables live in whichever Postgres the panel chooses (today: reuse
 * SquishyBot's DB via `squishyDb`, since panel-side data is tiny and a
 * separate DB just for sessions is overkill). See `web/src/lib/db/migrations/`
 * for the DDL.
 */
export * from './sessions'

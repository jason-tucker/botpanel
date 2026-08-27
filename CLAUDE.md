# Botpanel — AI Coding Instructions

These instructions apply to Claude Code and any AI coding tool working in this repo.

---

## Mandatory rules

### 1. Always update CHANGELOG.md
Add entries under `## [Unreleased]` for any meaningful change. One line per entry, in the same response as the code change.

### 2. Never run TypeScript compilation on the VPS
`pnpm typecheck` / `tsc` / `next build` OOM the VPS. Run those in CI only. Describe suspected type errors in text instead.

### 3. No host ports, ever
Every container talks over the docker network. Cloudflare Tunnel is the only ingress. If you find yourself writing `ports: ["x:y"]` in `docker-compose.yml`, STOP and use `expose:` + network aliases instead.

### 4. Hostname is env-configurable
The app never hardcodes a domain. `PUBLIC_BASE_URL` env (set at deploy time) is the source of truth for cookie domain, CSRF origin, OAuth redirect URI, etc.

### 5. Audit every state-changing action
Every write API route calls `writeAudit(...)` with `actor`, `viewing` (impersonated user if View-As is on), before, after, `via: 'web'`. Mirror the existing bot audit patterns.

### 6. Main-only branching
**All feature work targets `main` directly via PRs.** No long-lived intermediate branch.

1. Branch from `main` (or `origin/main`), do the work, push, open PR with `gh pr create --base main`.
2. CI runs `verify-schemas` + a full Docker build of both images on every PR (no GHCR push on PRs).
3. Merge to `main` → CI builds + pushes `ghcr.io/jason-tucker/botpanel{,-web}:latest` → watchtower auto-pulls onto the prod clone within ~30s → verify on `https://bots.tucker.host/`.
4. **Standing merge authorization (Jason, 2026-08-01):** once a Claude-authored PR is CI-green and expected to work, squash-merge it (one commit per PR) without waiting for a per-PR go-ahead — watchtower ships `main` automatically. Cross-repo ordering still applies (bot schema PRs merge before the dependent botpanel PR). Hold for explicit approval only on risky/destructive changes (migrations that drop or rewrite data, auth/permission changes) or when the change is genuinely ambiguous.

**Bot repos follow the same model.** SquishyBot and OtterBot PRs also target `main` directly.

**Historical note:** botpanel used to have a `dev` branch + dev clone (`/home/botuser/projects/botpanel-dev/`, port 6081, served at `dev-bots.tucker.host`). The dev environment was removed entirely in PR (tracking issue #196) — the pre-merge CI on PRs gives the validation the dev clone used to provide, without the overhead of a second running stack. If you see `:dev` image references in old logs or the dev-bots subdomain in cloudflared, those are stale and can be cleaned up at any pace.

---

## Agent usage

Always spawn agents to do work. Haiku for lookups. Sonnet for coding. Opus for planning.

Use agents proactively — delegation is the default, not a fallback. Match the model to the task:

- **Haiku** — file discovery, repository searches, quick lookups, lightweight analysis, and simple verification.
- **Sonnet** — coding, implementation, refactoring, debugging, writing tests, editing documentation, and normal technical work.
- **Opus** — architecture, complex planning, cross-repository strategy, high-risk changes, difficult debugging strategy, and final reconciliation.

How to delegate well:

- Run independent work in parallel; serialize only when there is a real dependency.
- Give every delegated task a precise scope and a concrete expected output.
- Require every agent to cite the paths, symbols, commands, or repository evidence behind its conclusions.
- Demand actionable results, not generic summaries.
- Never let two agents edit the same file at once — assign explicit file ownership and coordinate overlaps through the orchestrator.
- Resolve conflicting recommendations with repository evidence, not preference.
- Validate every agent's output before accepting it; re-run or re-scope on doubt.
- Use agents to improve speed or quality — not to create pointless duplication.
- The orchestrator reviews all delegated work and remains responsible for final correctness.

All `src/` paths in this document are relative to `web/` (e.g. `src/lib/auth/perms.ts` → `web/src/lib/auth/perms.ts`).

---

## Architecture overview

```
internet → Cloudflare Tunnel → cloudflared (STANDALONE container, --network host)
                                    ↓ ingress rule → http://localhost:6080
                                caddy (compose, 127.0.0.1:6080)
                                    ├─ on 5xx → landing/502.html (always-up)
                                    └─ reverse_proxy → next:3000 (MVP+)
                                                          ↓ docker network botpanel-net
                                            ┌───────┬────────────┐
                                            ↓       ↓            ↓
                                       db-squishy db-otter     redis
                                                                  ↑
                                                  ┌───────────────┘
                                                  │ pub/sub (events + RPC)
                                          ┌───────┴───────┐
                                      squishybot      otterbot
```

### Why cloudflared is standalone, not in compose

Compose `up -d` recreates containers whenever the compose file or env changes.
The original cloudflared container had its TUNNEL_TOKEN baked into env at
create time; a recreate wiped it and the tunnel went dark. Lesson: ingress
containers must outlive the application stacks they front.

Token lives in `/home/botuser/cloudflared/.env` (chmod 600). `--network host`
makes the Cloudflare ingress rule's `localhost:6080` reach the loopback-bound
Caddy. See the comment block in `docker-compose.yml` for the exact
`docker run` command. (The dev clone at `localhost:6081` was removed in issue #196;
any `:dev` image references or `dev-bots.tucker.host` ingress rules in cloudflared
are stale.)

## Stack (locked)

- Next.js 15 App Router · React · TypeScript · Tailwind · a custom UI kit (`web/src/components/ui/`) — no shadcn/radix component library; icons are mostly bespoke inline-SVG (`web/src/components/ui/icons.tsx`), with `lucide-react` (a runtime dependency) used for a few glyphs (e.g. `ExternalLink` in the OC/MKE/automation pages)
- Drizzle ORM · postgres-js · zod · ioredis · jose (JWT)
- Caddy 2 in front · cloudflared for ingress

## Auth model — capabilities, not tiers

`src/lib/auth/perms.ts` exports a single `resolveAccess(session, opts?: { viewAsUserId?: string })` that returns a flat capabilities map. Every API route + page reads this. **Do not invent new tier enums** — capabilities are explicit.

- **Bot owner** = `BOT_OWNER_ID` env (default `117501528641634310`). **[V2 — not yet implemented]**: Application Team Admins/Developers resolved via Redis `cmd.squishy.team.list` command bus verb.
- **Squishy sudo** = `SUDO_USER_IDS` env (comma-separated Discord IDs) + `sudo_users` DB table. `SUDO_ROLE_IDS` (role-based check) is a `TODO(V2)` in `src/lib/auth/perms.ts` — needs a Discord member fetch and is not yet live.
- **Voice owner/host/acting-owner** = `auto_channels` row check.
- **Otter business owner/manager/employee** = `business_owners` + `business_role_mappings` rank.
- **OC stock viewer / editor** = configurable, NOT hard-coded. `src/lib/otter/ocStockAccess.ts` reads `businesses.settings.ocStockAccess` on the `original-clothing` row (a panel-owned key inside a bot-owned JSONB column) and resolves a `{canView, canEdit, canConfigure, grantedByRole}` capability set from a minimum OC rank plus a Discord-role allowlist. Defaults: see = anyone signed in, edit = manager+. Bot owner and OC business owners always pass, and only they can change the rules. Editable from the Access card on `/otter/oc-stock`; enforced on the page, in the sidebar, and on every `/api/otter/oc-stock/**` route. The role allowlist needs `access.otter.roleIds`, which comes from otterbot's `business.user_ranks` reply.
- **Caked manager** / **MKE staff** = derived from business role mappings.
- **Member** = any logged-in Discord user; self-service only.

**View-As**: sudo/owner can act as someone else. Audit rows record BOTH `actor` (real) and `viewing` (impersonated). Plumb this through every audit hook from day one.

## Bot integration — Redis pub/sub only

No HTTP between panel and bots. Everything goes over Redis:

- **Events from bots** → `bot.<bot>.<domain>.<event>` (panel subscribes).
- **Commands from panel** → `cmd.<bot>.<verb>` request + paired `res.<requestId>` reply.
- HMAC envelope using shared `BOTPANEL_RPC_SECRET`.

The panel-side client lives in `src/lib/botrpc.ts`: `await callBot<T>(bot, verb, params, opts?)` returns `{ok:true, data:T} | {ok:false, error, details?}` — generates a 24-byte hex `requestId`, subscribes to `res.<requestId>` **before** publishing (race-free), publishes `cmd.<bot>.<verb>` with the HMAC envelope `{requestId, ts, hmac, params}` where `hmac = HMAC-SHA256(BOTPANEL_RPC_SECRET, "${channel}|${requestId}|${ts}|${JSON.stringify(params)}")`, and times out at 5s (configurable via `opts.timeoutMs`). Example: `const r = await callBot('squishy', 'echo', { message: 'hi' })`; on missing `BOTPANEL_RPC_SECRET` it returns `{ok:false, error:'rpc-not-configured'}` instead of throwing, so route handlers can render a friendly error card. Smoke-test the round-trip from `/sudo/rpc-test` (bot-owner only).

## Where to add things

| What | Where |
|---|---|
| New API route | `src/app/api/<bot>/<resource>/route.ts` — wrap in `withAuth(handler, { require?: 'any' \| 'sudo' \| 'botOwner', csrf?: boolean, rateLimit?: RateLimitSpec })` |
| New page | `src/app/<bot>/<area>/page.tsx` — gate via `resolveAccess(session)` in the layout |
| New DB query | `src/lib/db/{squishy,otter}.ts` — Drizzle clients, vendored schemas under `src/lib/db/schema/` |
| Cache-invalidation event | Call `publishInvalidate(bot, { table, key? })` from `src/lib/events/invalidate.ts` after any panel write that mutates a bot-cached row. The matching handler in the bot repo's `eventBus.ts` receives the HMAC-signed event on `bot.<botname>.settings.invalidate` and drops the cache entry. There is no general event-bus file — only this targeted invalidation helper. |
| New command-bus verb | Add the client call in `src/lib/botrpc.ts` (`callBot(bot, verb, params)`) and the handler in the bot repo |
| New audit hook | `src/lib/audit.ts` — call `writeAudit({...})` from the route handler |

## Schema sync

Bot schemas live in the bot repos. Panel uses **vendored copies** under `src/lib/db/schema/{squishy,otter}/`, kept in sync by `scripts/sync-schema.sh`. A CI step (`pnpm verify:schemas`) re-runs the sync and fails on diff — drift becomes a one-line PR, not a silent bug.

**Botpanel never runs `drizzle-kit generate` or `db:migrate` for the bot schemas** — migrations are owned by the bot repos.

**Panel-owned tables:** besides the vendored bot schemas, the panel owns `web/src/lib/db/schema/panel/` (`panel_sessions`, `push_subscriptions`). Their SQL lives in `web/src/lib/db/migrations/` (e.g. `0001_panel_sessions_aead.sql`, `0001_push_subscriptions.sql`) and is applied manually (`psql "$SQUISHY_DATABASE_URL" -f …`) or lazily via `CREATE TABLE IF NOT EXISTS`. The panel does not use drizzle-kit for these either — they are hand-written SQL applied once.

## Local dev

```bash
cd web
pnpm install
cp ../.env.example ../.env   # fill in the vars
pnpm dev                     # Next.js dev server on :3000
```

`pnpm build` and `pnpm typecheck` are CI-only — they OOM the VPS (rule 2). After a bot schema change, run `pnpm sync:schemas`; the CI gate is `pnpm verify:schemas`. There is no test suite and no `lint` script.

## Environment variables

Key vars parsed in `src/lib/env.ts` (full list in `.env.example`):

| Var | Notes |
|---|---|
| `SESSION_SECRET` | ≥ 32 chars; HS512 JWT signing key. Required for login. |
| `OAUTH_TOKEN_KEY` | 32 bytes as 64 hex chars (`openssl rand -hex 32`). AES-256-GCM for Discord refresh-token encryption at rest. |
| `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` | Discord OAuth. Without them `/api/auth/login` is disabled. |
| `BOT_OWNER_ID` | Discord snowflake; defaults to original owner. |
| `SUDO_USER_IDS` | Comma-separated snowflakes for implicit Squishy sudo (env path). |
| `GUILD_ID` | The guild the bots serve. |
| `PUBLIC_BASE_URL` | Cookie domain / OAuth redirect / CSRF origin. Never hardcoded. |
| `REDIS_URL` | Defaults to `redis://redis:6379`. |
| `BOTPANEL_RPC_SECRET` | HMAC key for the command bus; **must match both bot repos**. |
| `SQUISHY_DATABASE_URL` / `OTTER_DATABASE_URL` | Postgres connections (lazy — app boots without them). |
| `AUDIT_HASH_SALT` | Salt for IP/UA hashing in audit rows. Set a long random value in prod. |
| `VAPID_PUBLIC` / `VAPID_PRIVATE` / `VAPID_SUBJECT` | Web Push (VAPID). All three needed for push; otherwise subscribe routes return 503. |

## Deployment

One floating tag, one clone, one watchtower.

- **`main` branch** → CI builds `ghcr.io/jason-tucker/botpanel{,-web}:latest` and `:<sha>` → watchtower auto-pulls `:latest` → `/home/botuser/projects/botpanel/` (port 6080, served at `bots.tucker.host`).

The dev branch/clone/`:dev` tag/port 6081/`dev-bots.tucker.host` were removed (issue #196) — pre-merge CI on PRs now provides the validation the dev clone used to provide.

**Rollback:** pin a previous `:<sha>` image tag in `.env` (`BOT_IMAGE` / `NEXT_IMAGE`), then `docker compose pull && docker compose up -d`. Watchtower only follows floating tags (`:latest`), so a pinned SHA stays until you change it back.

See rule 6 above for the branch flow that drives this.

## CHANGELOG style note

This repo deliberately uses `## [Unreleased]` (accumulating under that heading until a release is cut). This is intentional and specific to botpanel — do not "fix" it to match sibling repos that use dated semver headings immediately.

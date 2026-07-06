# botpanel

Single web control panel for both of the server's Discord bots — **SquishyBot** and **OtterBot**. Sign in with Discord, and the panel exposes each bot's admin surface (voice rooms, settings, games, staff approvals, business/employee management, audit logs, and more) gated by the bots' own permission model. Reachable only through a Cloudflare Tunnel; the bots are driven entirely over Redis.

## Overview

botpanel replaces the bots' in-Discord `/sudo` and `/portal` flows with a mobile-first web UI. It is two cooperating pieces:

- **Caddy ingress** (`./` — root build) — a tiny always-up front door. Serves a static status landing page (`landing/`) and reverse-proxies everything else to the Next.js app, falling back to `landing/502.html` on any 5xx so a restart never shows a blank page.
- **Next.js app** (`web/`) — the actual panel. App Router, server-rendered pages plus route handlers for the API. Reads/writes both bots' Postgres databases directly (over the docker network) and talks to the live bot processes over Redis pub/sub for anything that needs the running client (voice ops, cache reloads, member lookups, live presence).

There is **no HTTP between the panel and the bots** and **no public host port on any container**. The only ingress is a Cloudflare Tunnel; bot control happens over an HMAC-signed Redis command bus.

The panel never owns schema. It reads the bots' tables through **vendored Drizzle schema copies** kept in sync by a script + CI check, and it never runs migrations — the bot repos own those.

## Architecture

```
internet
   │
   ▼
Cloudflare Tunnel
   │
   ▼
cloudflared  ── STANDALONE container, --network host (NOT in this compose stack)
   │            ingress rule → http://localhost:6080
   ▼
caddy  ── compose service, bound to 127.0.0.1:6080 (loopback only, never public)
   │       ├─ on 5xx → landing/502.html  (always-up status page)
   │       └─ reverse_proxy → next:3000
   ▼
next  ── Next.js app on botpanel-net (internal alias, no host port)
   │
   ├──────────────┬──────────────┬─────────────────────┐
   ▼              ▼              ▼                     ▼
db-squishy     db-otter        redis              watchtower
(Postgres)    (Postgres)    (pub/sub bus)        (auto-pull :latest)
                               ▲   ▲
                  events ──────┘   └────── commands + replies
                               │
                      ┌────────┴────────┐
                  squishybot         otterbot
                  (Redis only)       (Redis only)
```

- **cloudflared is standalone, not a compose service.** `docker compose up -d` recreates containers when the compose file or env changes; the original in-compose cloudflared lost its `TUNNEL_TOKEN` on every recreate and the tunnel went dark. The ingress container must outlive the app stack it fronts. Its token lives in `/home/botuser/cloudflared/.env` (chmod 600); `--network host` makes the Cloudflare ingress rule's `localhost:6080` reach the loopback-bound Caddy. The exact `docker run` command is in the comment block in `docker-compose.yml`.
- **Caddy binds `127.0.0.1:6080`** so the host-network cloudflared (or any localhost process) can reach it. That loopback bind is **not** a public exposure — `127.0.0.1` is unreachable from the internet, and Cloudflare Tunnel remains the only path in. No `0.0.0.0` port mapping exists anywhere in the stack.
- **Postgres is the bots' own.** `squishybot` and `otterbot` each run their own Postgres container; both are bound to loopback on the host and joined to the shared external `botpanel-net` docker network with aliases `db-squishy` / `db-otter`. The panel reaches them by those DNS names.
- **Redis is the only panel↔bot channel** — events flow bot→panel, commands flow panel→bot with paired replies. See [Usage](#usage).

## Stack

- **Next.js 15** (App Router) · **React 19** · **TypeScript** · **Tailwind**
- **Drizzle ORM** + **postgres-js** (two clients: `db/squishy.ts`, `db/otter.ts`) · vendored schemas under `web/src/lib/db/schema/{squishy,otter,panel}/`
- **ioredis** — subscriber singleton (`lib/redis.ts`) + per-call publisher/subscriber for RPC (`lib/botrpc.ts`)
- **jose** — JWT session cookies (HS512) · **zod** — env + request validation
- **web-push** — VAPID Web Push notifications
- **Caddy 2** ingress · **cloudflared** tunnel · **Redis 7** bus · package manager **pnpm 10**

## Quick start

> Production runs as containers off GHCR images (see [Deployment](#deployment)). This section is for local development of the `web/` app.

```bash
cd web
pnpm install
cp ../.env.example ../.env   # then fill in the vars below; the app reads process.env
pnpm dev                     # Next.js dev server on :3000
```

The env is **zod-validated at boot** (`web/src/lib/env.ts`) — a missing or malformed var throws immediately rather than surfacing as a runtime `undefined`. Most vars are optional so the app still boots for landing-only / lab flows; the features that need them degrade gracefully (login disabled, push no-ops, RPC returns a friendly error) instead of crashing.

> **Do not** run `pnpm typecheck` / `tsc` / `next build` on the production VPS — they OOM it. Type-check locally or let CI do it. (See `CLAUDE.md` rule 2.)

## Configuration

All env is parsed once in `web/src/lib/env.ts`. Notable vars:

| Var | Required for | Notes |
|---|---|---|
| `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` | OAuth login | From the Discord dev portal. Without them `/api/auth/login` is disabled. |
| `SESSION_SECRET` | Session cookies | ≥ 32 chars; HS512 JWT signing key. No secret ⇒ login flow disabled. |
| `OAUTH_TOKEN_KEY` | Encrypting Discord refresh tokens at rest | 32 bytes as 64 hex chars (`openssl rand -hex 32`). Drives AES-256-GCM in `auth/tokenCrypto.ts`. If unset, the OAuth callback skips refresh-token persistence (login still works, silent refresh won't). |
| `BOT_OWNER_ID` | Bot-owner gate | Discord snowflake. Defaults to the original owner. |
| `SUDO_USER_IDS` | Squishy sudo (env path) | Comma-separated snowflakes that get implicit sudo, in addition to the `sudo_users` DB table. |
| `GUILD_ID` | Guild-scoped UI gating | The guild the bots run in. |
| `PUBLIC_BASE_URL` | Cookie domain / OAuth redirect / CSRF origin | Source of truth for the public URL. The app never hardcodes a domain. |
| `REDIS_URL` | Bot RPC, events, cache-invalidate | Defaults to `redis://redis:6379` on `botpanel-net`. |
| `BOTPANEL_RPC_SECRET` | HMAC envelope for the command bus | ≥ 32 chars. **Must match the same var on both bot repos.** Unset ⇒ `callBot()` returns `{ok:false,error:'rpc-not-configured'}` and `publishInvalidate()` no-ops. |
| `SQUISHY_DATABASE_URL` / `OTTER_DATABASE_URL` | DB reads/writes | Lazy — the panel boots without them; queries degrade to empty results. |
| `AUDIT_HASH_SALT` | IP/UA hashing in audit rows | Set a long random value in prod so hashes are stable across deploys and not source-guessable. |
| `VAPID_PUBLIC` / `VAPID_PRIVATE` / `VAPID_SUBJECT` | Web Push | Generate with `pnpm --filter web exec web-push generate-vapid-keys`. All three needed for push to fire; otherwise `/api/push/subscribe` 503s and the dispatcher no-ops. The browser fetches the public key at runtime from `/api/push/config` — there is intentionally **no** `NEXT_PUBLIC_VAPID_PUBLIC` (Next inlines `NEXT_PUBLIC_*` at build time, so a CI image baked without it couldn't be fixed by editing `.env`). |
| `NEXT_ALIAS` / `NEXT_HOST` | docker-network wiring | The Next service's alias on `botpanel-net` (`NEXT_ALIAS`) and the name Caddy reverse-proxies to (`NEXT_HOST`). Default `next-prod`. |
| `PORT` | Caddy listen port | Caddy listens on this inside the network and binds `127.0.0.1:$PORT` on the host. Default `6080`. |
| `BOT_IMAGE` / `NEXT_IMAGE` | Which GHCR tags the stack pulls | Default `:latest`. |
| `GIT_SHA` / `BUILD_TIME` | Build metadata in the footer | Set by CI; harmless defaults locally. |

## Usage

### Auth model — capabilities, not tiers

Sign-in is **Discord OAuth2** (`identify guilds guilds.members.read`). The session is a JWT (HS512, `jose`) in a `__Host-session` cookie — `HttpOnly; Secure; SameSite=Lax; Path=/`, 3-day sliding TTL. The user's Discord refresh token is AES-256-GCM encrypted (`auth/tokenCrypto.ts`) and stored in a panel-owned `panel_sessions` row keyed by a per-session `jti`.

`web/src/lib/auth/perms.ts` exports a single `resolveAccess(session, { viewAsUserId? })` that returns a **flat capability map** — not a tier enum:

```ts
{
  actor:   { id, username, avatar },           // the real signed-in user
  viewing: { id, username, avatar },           // === actor unless View-As is on
  botOwner: boolean,
  squishy: { sudo: boolean, voiceChannels: string[], canSelfEdit: true },
  otter:   { businesses: Record<slug, 'owner'|'manager'|'employee'> },
}
```

Resolution sources:

| Capability | Source |
|---|---|
| `botOwner` | env `BOT_OWNER_ID` (Discord Application Team membership is a documented follow-up) |
| `squishy.sudo` | env `SUDO_USER_IDS` ∪ `sudo_users` DB table |
| `squishy.voiceChannels` | `auto_channels` rows where the user is `owner_user_id` or `acting_owner_user_id` |
| `otter.businesses[slug]` | otterbot `business.user_ranks` RPC (folds `business_owners` + Discord-role-mapped ranks), cached 60s |

Every DB/RPC lookup is wrapped — a downed Postgres or bot degrades to *empty capabilities* rather than a 500.

**Gating.** API routes wrap their handler in `withAuth(handler, opts?)`:

- `require: 'any' | 'sudo' | 'botOwner'` — `'sudo'` passes Squishy sudo **or** bot owner.
- **CSRF** is verified on every state-changing method (POST/PUT/PATCH/DELETE) via the double-submit `__Host-csrf` cookie + `x-csrf-token` header (or `_csrf` form field); GETs bypass it as idempotent reads. Opt out with `csrf: false`.
- **Rate limiting** via an optional per-actor in-memory token bucket (`rateLimit: { points, perSeconds }`), keyed on the *real* actor so View-As gets no extra quota.

Pages call `resolveAccess()` directly in the `(dashboard)` layout — they need the map to render, not just to gate.

**View-As.** Sudo / bot-owner can act as another user. `resolveAccess` resolves the **real** actor first and only swaps `viewing` if the actor passes the gate, so impersonation can never escalate; a forged `__Host-view-as` cookie on a non-privileged session is a no-op. Routes: `POST /api/sudo/view-as` (set, emits `auth.view_as_started`), `DELETE /api/sudo/view-as` (clear, `auth.view_as_ended`); self-View-As returns 400. A sticky red banner shows across every authed page while it's active.

**Audit.** Every state-changing route calls `writeAudit(...)` (`web/src/lib/audit.ts`) recording both `actor` (real) and `viewing` (impersonated), plus `before`/`after` and `via: 'web'`. Squishy settings edits land in `setting_changes`; Otter actions land in `audit_logs`. Audit is best-effort — a failed insert never blocks the underlying write. Bot owner can wipe every other session via `POST /api/admin/auth/logout-all` (CSRF-checked, 1/hour).

### Panel areas

| Area | Audience | What it does |
|---|---|---|
| `/` landing | anyone | Status page with live per-bot heartbeat dots; auto-redirects signed-in viewers to `/me` when both bots are online. |
| `/me`, `/me/edit`, `/me/games` | any member | Self-service: profile, color role, game ping/view preferences, "currently in voice" + game-prefs cards, staff-role request, `/report`. |
| `/squishy/voice` | voice owner/host/acting-owner, sudo | Live voice rooms (SSE) with lock / hide / rename / transfer / disconnect / host-toggle controls. |
| `/squishy/games` | sudo | Game catalog editor: role/channel links, inline "+ Create" + auto-provision, "Post LFG" per row. |
| `/squishy/settings`, `/squishy/welcome` | sudo | `bot_settings` editor (per-key numeric bounds enforced), welcome/goodbye with live preview. |
| `/squishy/roles`, `/squishy/automation`, `/squishy/hubs`, `/squishy/archives` | sudo | Reaction roles, auto-join/color roles, auto-thread + social feeds, hub channels + lockdown, archives. |
| `/squishy/self-assign-roles` | sudo | Self-assign role board editor: channel picker, add-role/game entries (auto-join roles highlighted), enable/disable + reorder, Publish to post/refresh the toggle-button embeds. |
| `/squishy/game-night` | sudo | Game Night scheduler: design a Components-V2 post in the shared message editor, target a channel, post now or schedule for later; list shows scheduled/posted/failed/canceled with send-now/edit/delete. |
| `/squishy/members`, `/squishy/members/[id]`, `/squishy/profiles` | sudo | Member browser + per-member detail (games, color role, sudo grant), profiles. |
| `/squishy/audit`, `/audit` | sudo | Audit tail (live via SSE). |
| `/otter/businesses`, `/otter/businesses/[slug]` (+ `notes`, `standings`, `audit`) | business owner/manager/employee | Business management: roster hire/fire/promote/demote, owners, role mappings, notes, standings, role sync, custom command buttons editor (Link/Info buttons on `/oc`/`/caked`/`/info`). |
| `/otter/oc-stock`, `/otter/caked`, `/otter/mke` | OC/Caked/MKE staff | OC stock editor + public post, Caked/OC channel messages, MKE surface (lookups link out). |
| `/sudo`, `/sudo/debug`, `/sudo/rpc-test` | sudo / bot-owner | Sudo console: staff approvals, sudo-user management, View-As, admin tools (orphan scan, reconciler, reload caches), push opt-in, and a bot-owner RPC round-trip smoke test. |

### Redis bot integration

The panel and bots share `botpanel-net` and a single Redis (`redis://redis:6379`). Three traffic patterns, all keyed by the shared `BOTPANEL_RPC_SECRET`:

1. **Events (bot → panel).** Bots publish on `bot.<bot>.<domain>.<event>`. The panel consumes via one lazy subscriber singleton (`lib/redis.ts`):
   - `lib/heartbeats.ts` psubscribes `bot.*.bot.heartbeat` (60s beat, payload `{version, uptime, ts}`, +`guildCount` for otter) and aggregates last-seen per bot for the landing/health surfaces; entries stale out after 180s.
   - SSE route handlers attach their own `pmessage` filters to the shared subscriber: `/api/squishy/voice/stream` psubscribes `bot.squishy.voice.*`; `/api/audit/stream` psubscribes `bot.squishy.settings.setting_changed` + `bot.otter.audit.written`.
2. **Commands (panel → bot, request/reply).** `callBot<T>(bot, verb, params, opts?)` in `lib/botrpc.ts`:
   - generates a 24-byte hex `requestId`, **subscribes to `res.<requestId>` before publishing** (race-free), then publishes `cmd.<bot>.<verb>` with the envelope `{ requestId, ts, hmac, params }` where `hmac = HMAC-SHA256(BOTPANEL_RPC_SECRET, "<channel>|<requestId>|<ts>|<JSON.stringify(params)>")`;
   - resolves on the first reply or a **5s** timeout (`opts.timeoutMs`), tearing the per-call subscriber down either way. The bot drops a bad-HMAC request silently (a "bad HMAC" reply would be an oracle), so the caller just times out.
   - Returns `{ok:true,data}` / `{ok:false,error}`; on unset `BOTPANEL_RPC_SECRET` it returns `{ok:false,error:'rpc-not-configured'}` rather than throwing, so a route can render a friendly card. Smoke-test from `/sudo/rpc-test` (bot-owner only).
3. **Cache invalidation (panel → bot, fire-and-forget).** After a write that mutates a bot-cached row, `publishInvalidate(bot, { table, key? })` (`lib/events/invalidate.ts`) publishes an HMAC-signed event on `bot.<bot>.settings.invalidate` so the bot reloads its in-memory cache without a restart. Errors log-only — a Redis hiccup never fails the write that just succeeded.

## Deployment

CI → GHCR → Watchtower; one stack on the VPS, served at `bots.tucker.host` via the standalone cloudflared.

- **CI** (`.github/workflows/deploy.yml`): on every push to `main` and on PRs to `main`, `verify-schemas` re-runs the schema sync and a full Docker build of **both** images runs. PRs build but **don't** push (`push: github.event_name == 'push'`). On a `main` push, two images publish to GHCR tagged `:latest` and `:<sha>`:
  - `ghcr.io/jason-tucker/botpanel` — the Caddy ingress image
  - `ghcr.io/jason-tucker/botpanel-web` — the Next.js app image
- **Watchtower** (in the compose stack, `nickfedor/watchtower`) polls GHCR every 30s and pulls + restarts any container whose `:latest` digest changed. Push to `main` → live in ~30s, no SSH.
- **No host ports.** Every container talks over `botpanel-net`; Caddy binds loopback only; cloudflared is the sole ingress.
- A separate workflow (`.github/workflows/sync-bot-schema.yml`) listens for `repository_dispatch` (`bot-schema-changed`) from the bot repos and opens/refreshes a rolling PR when vendored schemas drift, so a bot schema change can't leave `main` red.

Schema sync: `scripts/sync-schema.sh` copies the bots' Drizzle schemas into `web/src/lib/db/schema/{squishy,otter}/`; `pnpm verify:schemas` re-runs it and fails on diff. **The panel never runs `drizzle-kit generate` / `db:migrate`** — the bot repos own migrations. (The panel-owned `panel_sessions` and `push_subscriptions` tables ship as `CREATE TABLE IF NOT EXISTS` lazy creates with matching SQL under `web/src/lib/db/migrations/` for operators who prefer to apply them by hand.)

## Conventions

- **Changelog.** `CHANGELOG.md` follows real semver — one dated section per release, version + short SHA in the footer. Add entries in the same change as the code.
- **Branching.** All work targets `main` directly via PRs (`gh pr create --base main`). There is no long-lived `dev` branch (the old `dev` branch + dev clone were removed; pre-merge CI on PRs gives the same validation). Bot repos follow the same model.
- **Project board.** Every PR / unit of work gets an item on the [Bot Development board (#3)](https://github.com/users/jason-tucker/projects/3).
- **Deeper docs.** Repo-specific AI/contributor rules live in `CLAUDE.md`. Architecture, auth model, the full Redis event/verb tables, deployment runbook, and the security checklist live in the [project wiki](https://github.com/jason-tucker/botpanel/wiki).

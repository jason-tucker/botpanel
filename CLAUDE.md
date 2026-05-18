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

**Bot repos follow the same model.** SquishyBot and OtterBot PRs also target `main` directly.

**Historical note:** botpanel used to have a `dev` branch + dev clone (`/home/botuser/projects/botpanel-dev/`, port 6081, served at `dev-bots.tucker.host`). The dev environment was removed entirely in PR (tracking issue #196) — the pre-merge CI on PRs gives the validation the dev clone used to provide, without the overhead of a second running stack. If you see `:dev` image references in old logs or the dev-bots subdomain in cloudflared, those are stale and can be cleaned up at any pace.

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

Token lives in `/home/botuser/cloudflared/.env` (chmod 600). One cloudflared
fronts both prod and dev clones — Cloudflare ingress rules point at
`localhost:6080` (prod) and `localhost:6081` (dev), and `--network host`
makes those addresses reach the Caddy containers bound to those loopback
ports. See the comment block in `docker-compose.yml` for the exact
`docker run` command.

## Stack (locked)

- Next.js 15 App Router · React · TypeScript · Tailwind · shadcn/ui
- Drizzle ORM · postgres-js · zod · ioredis · jose (JWT)
- Caddy 2 in front · cloudflared for ingress

## Auth model — capabilities, not tiers

`src/lib/auth/perms.ts` exports a single `resolveAccess(session, opts?: { viewAsUserId?: string })` that returns a flat capabilities map. Every API route + page reads this. **Do not invent new tier enums** — capabilities are explicit.

- **Bot owner** = `BOT_OWNER_ID` env (default `117501528641634310`) + Application Team Admins/Developers (resolved via Redis `cmd.squishy.team.list` command bus verb in V2).
- **Squishy sudo** = env user/role IDs + `sudo_users` table.
- **Voice owner/host/acting-owner** = `auto_channels` row check.
- **Otter business owner/manager/employee** = `business_owners` + `business_role_mappings` rank.
- **OC stock editor** / **Caked manager** / **MKE staff** = derived from business role mappings.
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
| New API route | `src/app/api/<bot>/<resource>/route.ts` — wrap in `withAuth(handler, { tier, scope? })` |
| New page | `src/app/<bot>/<area>/page.tsx` — gate via `resolveAccess(session)` in the layout |
| New DB query | `src/lib/db/{squishy,otter}.ts` — Drizzle clients, vendored schemas under `src/lib/db/schema/` |
| New Redis event subscriber | `src/lib/events/bus.ts` — typed via zod in `src/lib/events/types.ts` |
| New command-bus verb | Add the request/reply types in `src/lib/events/types.ts`, the client helper in `src/lib/botrpc.ts`, and the handler in the bot repo |
| New audit hook | `src/lib/audit.ts` — call `writeAudit({...})` from the route handler |

## Schema sync

Bot schemas live in the bot repos. Panel uses **vendored copies** under `src/lib/db/schema/{squishy,otter}/`, kept in sync by `scripts/sync-schema.sh`. A CI step (`pnpm verify:schemas`) re-runs the sync and fails on diff — drift becomes a one-line PR, not a silent bug.

**Botpanel never runs `drizzle-kit generate` or `db:migrate`.** Migrations are owned by the bot repos.

## Deployment

Two floating tags, two clones, one watchtower.

- **`dev` branch** → CI builds `ghcr.io/jason-tucker/botpanel{,-web}:dev` → watchtower auto-pulls → `/home/botuser/projects/botpanel-dev/` (port 6081, served at `dev-bots.tucker.host`).
- **`main` branch** → CI builds `ghcr.io/jason-tucker/botpanel{,-web}:latest` → watchtower auto-pulls → `/home/botuser/projects/botpanel/` (port 6080, served at `bots.tucker.host/`).

Touched containers restart; untouched ones keep running. The dev clone is **not** a separate redis/db world — it shares prod's botpanel-net, redis, and bot Postgres. The separation is only at the Caddy + Next.js + landing layer (per-clone `NEXT_ALIAS` / `NEXT_HOST` env vars give each clone a unique alias on botpanel-net).

See rule 6 above for the branch flow that drives this.

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

---

## Architecture overview

```
internet → Cloudflare Tunnel → cloudflared (container)
                                    ↓ docker network botpanel-net
                                caddy:6080
                                    ├─ on 5xx → landing/502.html (always-up)
                                    └─ reverse_proxy → next:3000 (MVP+)
                                                          ↓
                                            ┌───────┬────────────┐
                                            ↓       ↓            ↓
                                       db-squishy db-otter     redis
                                                                  ↑
                                                  ┌───────────────┘
                                                  │ pub/sub (events + RPC)
                                          ┌───────┴───────┐
                                      squishybot      otterbot
```

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

Push to `main` → GitHub Actions builds image → pushes to GHCR → VPS runs `docker compose pull && up -d`. Touched containers restart; untouched ones keep running.

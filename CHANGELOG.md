# Changelog

All notable changes to botpanel are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

### Added
- **MVP foundation — Next.js 15 dashboard scaffolding.** New `web/` subdirectory with the App Router app (`web/src/app/`), Tailwind + dark theme palette matching the landing page, zod-validated env (`web/src/lib/env.ts`), Discord OAuth helper (`web/src/lib/auth/discord.ts`), JWT session via `jose` in a `__Host-` cookie with 3-day sliding TTL (`web/src/lib/auth/session.ts`). Routes shipped: `GET /` (sign-in / signed-in card), `GET /me` (auth-gated demo page that redirects to login), `GET /api/auth/login` (random-state Discord OAuth redirect), `GET /api/auth/callback` (state-verified token exchange + session mint), `POST /api/auth/logout`, `GET /api/auth/me`, `GET /api/healthz` (returns 200 — landing page status badge will go 🟢 once this image is up). Auth disabled until `DISCORD_CLIENT_ID` + `DISCORD_CLIENT_SECRET` + `SESSION_SECRET` + `PUBLIC_BASE_URL` are set in `.env`; without them the home page shows the sign-in button but `/api/auth/login` returns 503. Multi-stage Dockerfile (`web/Dockerfile`) outputs Next standalone on `node:22-alpine`.
- **docker-compose.yml gains a `next` service** alongside the existing caddy + cloudflared + watchtower. `NEXT_IMAGE` env var picks the floating tag (`:latest` / `:dev`). No host port mapping; Caddy proxies via the docker network. Watchtower auto-pulls when CI pushes a new image.
- **docker-compose.yml gains a `redis` service** (`redis:7-alpine`, internal only — `expose: 6379`, no host port). Joins `botpanel-net` so both bot stacks reach it as `redis:6379` over the shared external network. `--save 60 1` keeps a small AOF-free snapshot in a `redis_data` volume; `redis-cli ping` healthcheck. This is the single bus for events (bots → panel) AND commands (panel → bots, V2+) per the locked architecture.
- **Caddyfile flipped to `reverse_proxy next:3000`** with `handle_errors` falling back to `landing/502.html` on any 5xx so the page is always something useful. The `uri strip_prefix /dev` line from the path-based routing is preserved.
- **CI builds two images per push** — `botpanel:<tag>` (Caddy ingress, with bundled landing) and `botpanel-web:<tag>` (Next.js dashboard). Separate GHA cache scopes so a Next.js change doesn't bust the Caddy cache.

### Added
- **Phase 0 — landing page + Caddy ingress + Cloudflare Tunnel scaffolding.** Single Caddy container behind a `cloudflared` tunnel on the shared `botpanel-net` external docker network. Listens internally on `${PORT:-6080}` — NO host port mapping anywhere. Caddyfile serves `landing/index.html` (status indicator + helpful messaging for offline/updating/online states); `502.html` is the fallback Caddy serves when the future Next.js dashboard returns 5xx (also auto-refreshes every 10s). Build args bake the git SHA and build time into a meta tag the page reads.
- **Static landing page.** `landing/` is plain HTML/CSS/JS — no framework. Polls `/api/healthz` every 10s with a 3s timeout. Renders `online` / `updating` / `offline` based on response, plus per-bot heartbeat rows fed by the payload. Designed as "what you can still do right now" rather than a coming-soon splash.

### Security
- **All ingress flows through Cloudflare Tunnel.** No ports are bound on the VPS host — `cloudflared` connects outbound to Cloudflare's edge. The only world-bound port on the host stays SSH (`:22`).
- **Shared `botpanel-net` external docker network** so botpanel can reach the bots' Postgres DBs without any host port mapping. Both `squishybot` and `otterbot` compose stacks were updated in the same change to remove their public Postgres bindings and join this network with stable aliases `db-squishy` / `db-otter`.

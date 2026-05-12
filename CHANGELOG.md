# Changelog

All notable changes to botpanel are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

### Added
- **Phase 0 — landing page + Caddy ingress + Cloudflare Tunnel scaffolding.** Single Caddy container behind a `cloudflared` tunnel on the shared `botpanel-net` external docker network. Listens internally on `${PORT:-6080}` — NO host port mapping anywhere. Caddyfile serves `landing/index.html` (status indicator + helpful messaging for offline/updating/online states); `502.html` is the fallback Caddy serves when the future Next.js dashboard returns 5xx (also auto-refreshes every 10s). Build args bake the git SHA and build time into a meta tag the page reads.
- **Static landing page.** `landing/` is plain HTML/CSS/JS — no framework. Polls `/api/healthz` every 10s with a 3s timeout. Renders `online` / `updating` / `offline` based on response, plus per-bot heartbeat rows fed by the payload. Designed as "what you can still do right now" rather than a coming-soon splash.

### Security
- **All ingress flows through Cloudflare Tunnel.** No ports are bound on the VPS host — `cloudflared` connects outbound to Cloudflare's edge. The only world-bound port on the host stays SSH (`:22`).
- **Shared `botpanel-net` external docker network** so botpanel can reach the bots' Postgres DBs without any host port mapping. Both `squishybot` and `otterbot` compose stacks were updated in the same change to remove their public Postgres bindings and join this network with stable aliases `db-squishy` / `db-otter`.

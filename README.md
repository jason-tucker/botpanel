# botpanel

Single web dashboard for both Discord bots (SquishyBot + OtterBot). Logs in via Discord OAuth and gates everything behind the bots' existing permission model. See the design plan in `/home/botuser/.claude/plans/fancy-wondering-meadow.md`.

## Phase 0 — landing page only

This is the Phase 0 state: a Caddy container behind a Cloudflare Tunnel serving a static landing page with a status indicator. Next.js + auth come in MVP.

### Architecture

```
internet → Cloudflare Tunnel → cloudflared container
                                     ↓ docker network
                                 caddy:6080
                                  ↓ on 5xx → landing/502.html
                                 (future: next:3000)
```

- **No host ports** are mapped. Cloudflare Tunnel reaches Caddy over the docker `botpanel-net` external network.
- **Hostname and port are env-configurable** (`PORT`, `CF_TUNNEL_TOKEN`); Caddy doesn't care what domain points at it.
- **Landing page** under `landing/` is bundled into the Caddy image at build time. `git push` → CI rebuilds → `docker compose pull` on the VPS → Caddy hot-swaps.

### One-time setup

1. **Create the shared docker network** (only needed once per host):

   ```bash
   docker network create botpanel-net
   ```

   Both `squishybot` and `otterbot` compose stacks reference this network as `external: true` so botpanel can reach their Postgres DBs (named `db-squishy` and `db-otter` on this net).

2. **Cloudflare Tunnel:**

   - Open <https://one.dash.cloudflare.com/> → Zero Trust → Networks → Tunnels → Create Tunnel → "Cloudflared".
   - Name it `botpanel` (anything).
   - Copy the **tunnel token** from the "Install and run a connector" step (under "Docker").
   - In your Cloudflare zone, add a Public Hostname for the tunnel: any subdomain → service `http://caddy:6080`.

3. **Configure local env:**

   ```bash
   cp .env.example .env
   # set CF_TUNNEL_TOKEN to the token from step 2
   ```

4. **Run:**

   ```bash
   docker compose up -d --build
   ```

   Then hit your Cloudflare hostname in a browser — you should see the landing page. The status indicator will show 🔴 because there's no dashboard yet (expected).

### Deploys

Every push to `main` triggers GitHub Actions to build a new image and push to GHCR. To pick up changes on the VPS:

```bash
cd /home/botuser/projects/botpanel
docker compose pull
docker compose up -d
```

(or wire up a webhook / `cron @reboot` / `watchtower` later.)

### Files

- `landing/` — static landing page (HTML + CSS + JS + 502 fallback).
- `Caddyfile` — Phase 0 config: file_server only. Comments include the MVP version (reverse_proxy + handle_errors).
- `Dockerfile` — multi-stage will land in MVP; for now it just bundles landing files + Caddyfile into the `caddy:2-alpine` base.
- `docker-compose.yml` — caddy + cloudflared services on the `botpanel-net` external network. No host ports.

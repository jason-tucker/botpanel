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
   - In your Cloudflare zone, add a Public Hostname for the tunnel: any subdomain → service `http://localhost:6080` (or `http://caddy:6080` if running cloudflared in this compose stack).

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

5. **Discord Developer Portal — required when MVP lands (OAuth login + bot account):**

   This section is here so you can prep the dev portal while the Phase 0 landing page is up. Concrete steps:

   1. Open <https://discord.com/developers/applications> and pick the SquishyBot application (we reuse it; OtterBot keeps its own bot identity).
   2. **OAuth2 → Redirects:** Add `https://<your-hostname>/api/auth/callback` (e.g. `https://bots.tucker.host/api/auth/callback`).
   3. **OAuth2 → Client information:** Copy the **Client ID** (`DISCORD_CLIENT_ID` env) and **Client Secret** (`DISCORD_CLIENT_SECRET` env). Treat the secret like a password — don't commit it.
   4. **OAuth2 → Default Authorization Link → Scopes:** the panel requests `identify guilds guilds.members.read`. (These are user OAuth scopes, NOT bot scopes — the bot keeps its existing token.)
   5. **Team setup** (lets multiple Discord accounts have bot-owner access without sharing the env `BOT_OWNER_ID`):
      - Dev portal → Teams → create a team if you don't have one, then attach the application to it.
      - Add team members as **Admin** or **Developer** (Read-only is intentionally excluded by the panel).
      - The panel reads team membership at runtime via the existing `isBotOwner` resolver in [squishybot](https://github.com/jason-tucker/squishybot/blob/main/src/services/botOwner.ts).
   6. Both bots already have their bot accounts — no new bot token is needed for the panel.

   Re-deploy the panel (`scripts/botpanel update`) after setting the OAuth env vars.

### Deploys

GitHub Actions builds and pushes an image to GHCR on every push to `main`:

- `push` to `main` → `ghcr.io/jason-tucker/botpanel:latest` + `:<sha>`

The Watchtower service in the compose stack polls GHCR every 30 s and
restarts containers whose image tag has changed. **You don't need to SSH
in to deploy** — push to main and the host picks it up in ~30 s.

### Production

One stack on the VPS, served at `bots.tucker.host` via Cloudflare Tunnel → `localhost:6080`.

| Branch | Port | Image tag | Path |
|---|---|---|---|
| `main` | `6080` | `:latest` | `/home/botuser/projects/botpanel` |

### Files

- `landing/` — static landing page (HTML + CSS + JS + 502 fallback).
- `Caddyfile` — Phase 0 config: file_server only. Comments include the MVP version (reverse_proxy + handle_errors).
- `Dockerfile` — multi-stage will land in MVP; for now it just bundles landing files + Caddyfile into the `caddy:2-alpine` base.
- `docker-compose.yml` — caddy + cloudflared services on the `botpanel-net` external network. No host ports.

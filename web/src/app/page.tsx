import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/session'
import { getHeartbeats } from '@/lib/heartbeats'
import { env } from '@/lib/env'
import { relTime } from '@/lib/util/format'

/**
 * Public landing page (also serves `/status` semantically — there's no
 * separate `/status` route in MVP because this page already exposes the
 * full bot-status surface to unauthenticated visitors).
 *
 * Stays at the root layout (NOT inside the `(dashboard)` route group) so
 * unauthenticated visitors don't trip the dashboard layout's session
 * redirect. The page is composed of:
 *
 *   1. Hero — wordmark + tagline.
 *   2. Live bot status row — `getHeartbeats()` is read in-process (same
 *      Node process as the Redis subscriber), so this is essentially free.
 *      If `getHeartbeats()` throws (e.g. somehow the redis singleton is in
 *      a weird state) we catch and render both bots as 🔴; we never want
 *      the public home to 500.
 *   3. "What you can do here" — short orientation for first-time viewers.
 *   4. Auth slot — either a sign-in CTA or a "welcome back" card.
 *   5. Build footer — git SHA + build time + status anchor.
 *
 * Preserves the `?error=` red-card behavior from #55.
 */

const ERROR_MESSAGES: Record<string, string> = {
  missing_params: 'Discord didn’t return an auth code. Try again, and make sure to click Authorize on the consent screen.',
  bad_state: 'OAuth state mismatch — the sign-in took too long or was tampered with. Try again.',
  callback_failed: 'Discord rejected the auth code. The Client Secret may be stale or the redirect URI mismatched. Check server logs.',
}

type BotName = 'squishy' | 'otter'

const BOT_LABELS: Record<BotName, string> = {
  squishy: 'SquishyBot',
  otter: 'OtterBot',
}

const BOT_ORDER: BotName[] = ['squishy', 'otter']

interface BotStatus {
  name: BotName
  label: string
  online: boolean
  version?: string
  uptimeSec?: number
  lastBeatSec?: number
  lastSeen?: string
  guildCount?: number
}

/**
 * Local uptime formatter tuned for "this bot has been up for N days" rather
 * than `formatDuration`'s cooldown-column shape (which caps at hours and would
 * render a 5-day-old process as `"120h"`). Returns coarse text for the status
 * row — never empty, never NaN.
 */
function formatUptime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—'
  if (seconds < 60) return `${Math.round(seconds)}s`
  const min = Math.floor(seconds / 60)
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  const remMin = min % 60
  if (hr < 24) return remMin === 0 ? `${hr}h` : `${hr}h ${remMin}m`
  const day = Math.floor(hr / 24)
  const remHr = hr % 24
  return remHr === 0 ? `${day}d` : `${day}d ${remHr}h`
}

function readHeartbeatsSafe(): Record<string, Record<string, unknown>> {
  // `getHeartbeats()` is documented as never-throwing in practice (it reads
  // an in-memory map and returns `{}` when redis is dead), but the public
  // home page is the single most important page in the app — we treat any
  // unexpected throw as "no data" rather than crashing the whole render.
  try {
    return getHeartbeats()
  } catch {
    return {}
  }
}

function buildBotStatuses(raw: Record<string, Record<string, unknown>>): BotStatus[] {
  return BOT_ORDER.map((name) => {
    const row = raw[name]
    if (!row) {
      return { name, label: BOT_LABELS[name], online: false }
    }
    const version = typeof row.version === 'string' ? row.version : undefined
    const uptime = typeof row.uptime === 'number' ? row.uptime : undefined
    const lastBeatSec = typeof row.lastBeatSec === 'number' ? row.lastBeatSec : undefined
    const lastSeen = typeof row.lastSeen === 'string' ? row.lastSeen : undefined
    const guildCount = typeof row.guildCount === 'number' ? row.guildCount : undefined
    return {
      name,
      label: BOT_LABELS[name],
      online: row.online === true,
      version,
      uptimeSec: uptime,
      lastBeatSec,
      lastSeen,
      guildCount,
    }
  })
}

function BotStatusCard({ bot }: { bot: BotStatus }) {
  const ring = bot.online
    ? 'border-emerald-500/40 ring-1 ring-emerald-500/30'
    : 'border-red-500/40 ring-1 ring-red-500/30'
  const dot = bot.online ? 'bg-emerald-400' : 'bg-red-400'
  return (
    <div
      className={`rounded-xl border ${ring} bg-bg-card2 p-4 flex flex-col gap-2 transition-all duration-200`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            aria-label={bot.online ? 'online' : 'offline'}
            className={`inline-block w-2.5 h-2.5 rounded-full ${dot}`}
          />
          <span className="font-medium text-ink">{bot.label}</span>
        </div>
        {bot.version && (
          <span
            className="font-mono text-[10px] uppercase tracking-wider text-ink-dim bg-bg-card border border-line rounded px-1.5 py-0.5"
            title={`Version ${bot.version}`}
          >
            v{bot.version}
          </span>
        )}
      </div>

      {bot.online ? (
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-ink-dim">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-ink-dim/70">Uptime</div>
            <div className="text-ink text-sm">
              {bot.uptimeSec !== undefined ? formatUptime(bot.uptimeSec) : '—'}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-ink-dim/70">Last beat</div>
            <div className="text-ink text-sm">
              {bot.lastBeatSec !== undefined
                ? `${bot.lastBeatSec}s ago`
                : bot.lastSeen
                  ? relTime(bot.lastSeen)
                  : '—'}
            </div>
          </div>
          {bot.guildCount !== undefined && (
            <div className="col-span-2">
              <div className="text-[10px] uppercase tracking-wider text-ink-dim/70">Guilds</div>
              <div className="text-ink text-sm">{bot.guildCount.toLocaleString()}</div>
            </div>
          )}
        </div>
      ) : (
        <div className="text-xs text-ink-dim">no heartbeat yet</div>
      )}
    </div>
  )
}

function BotStatusRow({ heartbeats }: { heartbeats: Record<string, Record<string, unknown>> }) {
  const bots = buildBotStatuses(heartbeats)
  return (
    <section
      id="status"
      aria-labelledby="status-heading"
      className="rounded-2xl border border-line bg-bg-card p-5 flex flex-col gap-3"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="status-heading" className="text-sm font-semibold uppercase tracking-wider text-ink-dim">
          Bot status
        </h2>
        <span className="text-[10px] uppercase tracking-wider text-ink-dim/70">
          live · heartbeats every 60s
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {bots.map((b) => (
          <BotStatusCard key={b.name} bot={b} />
        ))}
      </div>
    </section>
  )
}

function WhatYouCanDo() {
  const bullets: Array<{ title: string; body: string }> = [
    {
      title: 'Read-only settings views',
      body: 'Inspect Squishy & Otter configuration without touching a Discord client.',
    },
    {
      title: 'Live voice presence',
      body: 'See currently-spawned voice channels and who’s in them, updated in real time.',
    },
    {
      title: 'Unified audit tail',
      body: 'Merged Squishy + Otter audit log with live tailing for sudo viewers.',
    },
    {
      title: 'Businesses & OC stock',
      body: 'Browse Otter businesses, role mappings, standings, and the public OC stock list.',
    },
  ]
  return (
    <section
      aria-labelledby="capabilities-heading"
      className="rounded-2xl border border-line bg-bg-card p-5 flex flex-col gap-3"
    >
      <h2 id="capabilities-heading" className="text-sm font-semibold uppercase tracking-wider text-ink-dim">
        What you can do here
      </h2>
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {bullets.map((b) => (
          <li key={b.title} className="rounded-lg bg-bg-card2 border border-line p-3">
            <div className="text-ink text-sm font-medium">{b.title}</div>
            <div className="text-ink-dim text-xs mt-1 leading-relaxed">{b.body}</div>
          </li>
        ))}
      </ul>
    </section>
  )
}

export default async function Home({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const session = await getSession()
  const params = await searchParams
  const errorMsg = params.error ? (ERROR_MESSAGES[params.error] ?? `Sign-in error: ${params.error}`) : null

  const heartbeats = readHeartbeatsSafe()

  // If the viewer is signed in AND both bots are online AND there's no
  // sign-in error to show, send them straight to `/me` — the landing page
  // is mostly a "is this thing on?" indicator for unauth'd or partial-outage
  // states, so skipping it when everything's green saves a click.
  if (session && !errorMsg) {
    const bots = buildBotStatuses(heartbeats)
    const allOnline = bots.length > 0 && bots.every((b) => b.online)
    if (allOnline) {
      redirect('/me')
    }
  }

  return (
    <main className="min-h-dvh flex flex-col items-center px-4 py-10 sm:py-16">
      <div className="w-full max-w-3xl flex flex-col gap-6">
        {/* ─── Hero ──────────────────────────────────────────────────── */}
        <header className="flex flex-col gap-2 text-center sm:text-left">
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-ink">Botpanel</h1>
          <p className="text-ink-dim text-base sm:text-lg">
            Discord admin dashboard for SquishyBot &amp; OtterBot.
          </p>
        </header>

        {errorMsg && (
          <div className="rounded-lg border border-red-900 bg-red-950/40 text-red-200 text-sm p-3">
            {errorMsg}
          </div>
        )}

        {/* ─── Live bot status row ───────────────────────────────────── */}
        <BotStatusRow heartbeats={heartbeats} />

        {/* ─── What you can do here ──────────────────────────────────── */}
        <WhatYouCanDo />

        {/* ─── Auth slot ─────────────────────────────────────────────── */}
        <section
          aria-labelledby="auth-heading"
          className="rounded-2xl border border-line bg-bg-card p-5 flex flex-col gap-4"
        >
          {session ? (
            <>
              <h2 id="auth-heading" className="text-sm font-semibold uppercase tracking-wider text-ink-dim">
                Signed in
              </h2>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="text-ink text-lg">
                  Welcome back, <span className="font-semibold">{session.username}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Link
                    href="/me"
                    className="inline-flex items-center justify-center rounded-lg bg-accent text-white font-semibold px-4 py-2.5"
                  >
                    Open dashboard
                  </Link>
                  <form action="/api/auth/logout" method="POST">
                    <button
                      type="submit"
                      className="inline-flex items-center justify-center rounded-lg border border-line bg-transparent text-ink-dim hover:text-ink hover:bg-bg-card2/50 px-3 py-2.5 text-sm"
                    >
                      Sign out
                    </button>
                  </form>
                </div>
              </div>
            </>
          ) : (
            <>
              <h2 id="auth-heading" className="text-sm font-semibold uppercase tracking-wider text-ink-dim">
                Get started
              </h2>
              <p className="text-ink-dim text-sm">
                Sign in with Discord to access the dashboard. Permissions are derived from your roles &amp;
                business mappings — most pages are sudo- or owner-gated.
              </p>
              <div>
                <a
                  href="/api/auth/login"
                  className="inline-flex items-center justify-center rounded-lg bg-accent text-white font-semibold px-4 py-2.5"
                >
                  Sign in with Discord
                </a>
              </div>
            </>
          )}
        </section>

        {/* ─── Footer ────────────────────────────────────────────────── */}
        <footer className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-[11px] text-ink-dim/80 border-t border-line pt-4">
          <div className="font-mono">
            build <span className="text-ink-dim">{env.GIT_SHA.slice(0, 7)}</span>
            <span className="px-1">·</span>
            deployed <span className="text-ink-dim">{env.BUILD_TIME}</span>
          </div>
          <a href="#status" className="text-ink-dim hover:text-ink underline-offset-2 hover:underline">
            Status
          </a>
        </footer>
      </div>
    </main>
  )
}

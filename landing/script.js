// Botpanel landing page — status poller.
// Polls /api/healthz on the same origin every 10s with a 3s timeout.
// Renders one of three states + helpful messaging for each.

const POLL_MS = 10_000
const TIMEOUT_MS = 3_000

const dot = document.getElementById('dot')
const label = document.getElementById('label')
const headline = document.getElementById('headline')
const subline = document.getElementById('subline')
const openBtn = document.getElementById('open-dashboard')
const adviceList = document.getElementById('advice-list')
const squishyDot = document.getElementById('squishy-dot')
const otterDot  = document.getElementById('otter-dot')
const squishyDetail = document.getElementById('squishy-detail')
const otterDetail   = document.getElementById('otter-detail')

const STATES = {
  online: {
    cls: 'online',
    label: 'Dashboard online',
    headline: 'Botpanel',
    subline: 'Pick where you want to go.',
    advice: [
      'The dashboard is up — click **Open dashboard** above.',
      'You can still use the bots from Discord with <code>/sudo</code>, <code>/games</code>, <code>/profile</code>, etc.',
    ],
    showOpen: true,
  },
  updating: {
    cls: 'updating',
    label: 'Dashboard updating',
    headline: "We're deploying a new build",
    subline: 'The dashboard will be back in a moment. The bots themselves are still running.',
    advice: [
      'Run slash commands on Discord normally — the bots are unaffected.',
      'This page will auto-refresh when the dashboard comes back online.',
    ],
    showOpen: false,
  },
  offline: {
    cls: 'offline',
    label: 'Dashboard offline',
    headline: 'Dashboard is offline',
    subline: "It looks like the dashboard isn't reachable right now.",
    advice: [
      'The bots themselves may still be running. Check Discord first.',
      'If both are down, ping the bot owner.',
      'This page will keep polling and update automatically.',
    ],
    showOpen: false,
  },
}

function render(state) {
  const s = STATES[state]
  if (!s) return

  dot.classList.remove('online', 'updating', 'offline')
  dot.classList.add(s.cls)
  label.textContent = s.label
  headline.textContent = s.headline
  subline.textContent = s.subline
  openBtn.classList.toggle('hidden', !s.showOpen)

  adviceList.innerHTML = ''
  for (const item of s.advice) {
    const li = document.createElement('li')
    li.innerHTML = item.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    adviceList.appendChild(li)
  }
}

async function poll() {
  let state = 'offline'
  let payload = null
  try {
    const ac = new AbortController()
    const tid = setTimeout(() => ac.abort(), TIMEOUT_MS)
    const res = await fetch('/api/healthz', { cache: 'no-store', signal: ac.signal })
    clearTimeout(tid)
    if (res.ok) {
      state = 'online'
      payload = await res.json().catch(() => null)
    } else if (res.status >= 500) {
      state = 'updating'
    } else {
      state = 'offline'
    }
  } catch (_) {
    state = 'offline'
  }
  render(state)
  renderBots(payload)
}

function renderBots(payload) {
  // payload?.bots example: { squishy: { online: true, lastBeatSec: 12 }, otter: ... }
  const bots = payload?.bots ?? {}
  applyBotRow(squishyDot, squishyDetail, bots.squishy)
  applyBotRow(otterDot, otterDetail, bots.otter)
}
function applyBotRow(dotEl, detailEl, b) {
  dotEl.classList.remove('online', 'updating', 'offline')
  if (!b) {
    dotEl.classList.add('offline')
    detailEl.textContent = 'no heartbeat yet'
    return
  }
  if (b.online) {
    dotEl.classList.add('online')
    detailEl.textContent = `online — last beat ${humanSec(b.lastBeatSec)} ago`
  } else {
    dotEl.classList.add('offline')
    detailEl.textContent = `silent for ${humanSec(b.lastBeatSec ?? 0)}`
  }
}
function humanSec(s) {
  if (s < 60) return `${Math.round(s)}s`
  if (s < 3600) return `${Math.round(s / 60)}m`
  return `${Math.round(s / 3600)}h`
}

// Inject build info from <meta> if Caddy/CI populated them.
const meta = document.head.querySelector('meta[name="build-sha"]')
if (meta?.content) document.getElementById('build-sha').textContent = meta.content
const tmeta = document.head.querySelector('meta[name="build-time"]')
if (tmeta?.content) document.getElementById('build-time').textContent = tmeta.content

poll()
setInterval(poll, POLL_MS)

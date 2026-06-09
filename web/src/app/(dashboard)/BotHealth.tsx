'use client'
/**
 * BotHealth — live status pills in the topbar.
 *
 * Seeds from a server snapshot (so the first paint is correct) then polls
 * `GET /api/health/bots` every 30s. `getHeartbeats()` omits stale/offline
 * bots entirely, so a bot missing from the map is rendered as offline. The
 * pill's `title` carries uptime / last-beat / guild-count detail on hover.
 */
import { useEffect, useState } from 'react'
import type { ShellHealth } from './shellTypes'
import { cn } from '@/components/ui/cn'

const LABELS: Record<string, string> = { squishy: 'Squishy', otter: 'Otter' }
const ORDER = ['squishy', 'otter']

function formatUptime(seconds?: number): string {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return '—'
  if (seconds < 60) return `${Math.round(seconds)}s`
  const min = Math.floor(seconds / 60)
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h`
  return `${Math.floor(hr / 24)}d`
}

export function BotHealth({ initial }: { initial: ShellHealth }) {
  const [health, setHealth] = useState<ShellHealth>(initial)

  useEffect(() => {
    let alive = true
    const tick = async () => {
      try {
        const r = await fetch('/api/health/bots', { credentials: 'same-origin' })
        if (!r.ok) return
        const j = (await r.json()) as { bots?: ShellHealth }
        if (alive && j && typeof j === 'object' && j.bots) setHealth(j.bots)
      } catch {
        // leave last-known state on a transient failure
      }
    }
    const id = setInterval(tick, 30_000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [])

  return (
    <div className="flex items-center gap-1.5">
      {ORDER.map((name) => {
        const e = health[name]
        const online = Boolean(e?.online)
        const detail = online
          ? `${LABELS[name]} online · up ${formatUptime(e?.uptimeSec)}${
              e?.lastBeatSec !== undefined ? ` · beat ${e.lastBeatSec}s ago` : ''
            }${e?.guildCount !== undefined ? ` · ${e.guildCount} guild(s)` : ''}`
          : `${LABELS[name]} offline — no recent heartbeat`
        return (
          <span
            key={name}
            title={detail}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] font-medium',
              online ? 'border-ok/30 bg-ok/10 text-ok' : 'border-err/30 bg-err/10 text-err',
            )}
          >
            <span className="relative flex h-1.5 w-1.5">
              {online && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ok opacity-60" />
              )}
              <span className={cn('relative inline-flex h-1.5 w-1.5 rounded-full', online ? 'bg-ok' : 'bg-err')} />
            </span>
            <span className="hidden md:inline">{LABELS[name]}</span>
          </span>
        )
      })}
    </div>
  )
}

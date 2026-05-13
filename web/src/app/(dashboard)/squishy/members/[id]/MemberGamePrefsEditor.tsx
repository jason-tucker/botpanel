'use client'

/**
 * `<MemberGamePrefsEditor>` — sudo-edit a target member's game prefs.
 *
 * Mirror of `<MyGamesEditor>` from `/me/games`, parameterized on the URL
 * target user id rather than the signed-in viewer. POSTs to the new
 * `/api/squishy/members/[id]/games` route which calls the bot's
 * `games.set_prefs` verb with the target's snowflake.
 *
 * The bot still enforces the "ping requires view" rule on its side; we
 * mirror it in the UI by greying out the Ping toggle when View is off so
 * an impossible combo can't be queued.
 */
import { useState, type ChangeEvent } from 'react'
import { useRouter } from 'next/navigation'
import { ServerForm } from '@/lib/forms/ServerForm'

export type GameRow = {
  gameId: string
  name: string
  aliases: string[]
  view: boolean
  ping: boolean
}

type LocalState = Map<string, { view: boolean; ping: boolean }>

const btnPrimary =
  'inline-flex items-center px-3 py-1.5 text-sm rounded-lg border border-line bg-bg-card2 text-ink hover:bg-bg-card2/70 transition-colors'

export function MemberGamePrefsEditor({
  userId,
  rows,
}: {
  userId: string
  rows: GameRow[]
}) {
  const router = useRouter()
  const [local, setLocal] = useState<LocalState>(() => {
    const m: LocalState = new Map()
    for (const r of rows) m.set(r.gameId, { view: r.view, ping: r.ping })
    return m
  })

  function setView(gameId: string, value: boolean) {
    setLocal((prev) => {
      const next = new Map(prev)
      const cur = next.get(gameId) ?? { view: false, ping: false }
      next.set(gameId, { view: value, ping: value ? cur.ping : false })
      return next
    })
  }

  function setPing(gameId: string, value: boolean) {
    setLocal((prev) => {
      const next = new Map(prev)
      const cur = next.get(gameId) ?? { view: false, ping: false }
      next.set(gameId, { view: cur.view || value, ping: value })
      return next
    })
  }

  const prefsPayload = JSON.stringify(
    Array.from(local.entries()).map(([gameId, p]) => ({
      gameId,
      view: p.view,
      ping: p.ping,
    })),
  )

  if (rows.length === 0) {
    return (
      <div className="text-sm text-ink-dim italic">
        No games in the catalog — add some via /sudo → Settings → Games.
      </div>
    )
  }

  return (
    <ServerForm
      action={`/api/squishy/members/${userId}/games`}
      method="POST"
      onSuccess={() => router.refresh()}
      className="flex flex-col gap-4"
    >
      <input type="hidden" name="_format" value="json" />
      <input type="hidden" name="prefs" value={prefsPayload} />

      <div className="rounded-xl border border-line bg-bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-bg-card2 text-xs uppercase tracking-wider text-ink-dim">
              <tr>
                <th className="px-3 py-2 font-medium">Game</th>
                <th className="px-3 py-2 font-medium w-28 text-center">View channel</th>
                <th className="px-3 py-2 font-medium w-28 text-center">LFG pings</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((g) => {
                const state = local.get(g.gameId) ?? { view: false, ping: false }
                return (
                  <tr key={g.gameId} className="border-b border-line last:border-b-0 align-top">
                    <td className="px-3 py-2 text-sm">
                      <div className="font-medium">{g.name}</div>
                      {g.aliases.length > 0 && (
                        <div className="text-[11px] text-ink-dim mt-0.5">
                          aka {g.aliases.join(', ')}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <input
                        type="checkbox"
                        aria-label={`Toggle View for ${g.name}`}
                        checked={state.view}
                        onChange={(e: ChangeEvent<HTMLInputElement>) =>
                          setView(g.gameId, e.target.checked)
                        }
                      />
                    </td>
                    <td className="px-3 py-2 text-center">
                      <input
                        type="checkbox"
                        aria-label={`Toggle Ping for ${g.name}`}
                        checked={state.ping}
                        disabled={!state.view}
                        title={!state.view ? 'Turn View on first to enable pings.' : undefined}
                        onChange={(e: ChangeEvent<HTMLInputElement>) =>
                          setPing(g.gameId, e.target.checked)
                        }
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button type="submit" className={btnPrimary}>
          Save game prefs
        </button>
        <span className="text-[11px] text-ink-dim">
          Changes apply on Discord immediately. View must be on before Pings can be on.
        </span>
      </div>
    </ServerForm>
  )
}

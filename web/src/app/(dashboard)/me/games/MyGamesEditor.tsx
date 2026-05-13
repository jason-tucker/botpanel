'use client'

/**
 * `<MyGamesEditor>` — the client island for `/me/games`.
 *
 * Holds the toggle state for every game row locally, lets the user flip
 * View / Ping freely, then submits the entire batch on Save through a single
 * `<ServerForm>` POST. The Form's body is a JSON `prefs: [{gameId, view,
 * ping}]` array — one round-trip even with dozens of games.
 *
 * The bot enforces "ping requires view" on its side (each row gets the view
 * write first, then ping). We mirror the rule in the UI by greying out the
 * Ping toggle when View is off so users can't queue an impossible state in
 * the first place.
 *
 * After a successful save we `router.refresh()` so the server-rendered page
 * re-reads from the DB and the displayed state matches what the bot just
 * persisted (including the cascade-off-when-view-disabled effect from
 * `setPref`).
 */
import { useEffect, useState, type ChangeEvent } from 'react'
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

// Green/success primary CTA. Tailwind's `ok` token isn't defined as a bg
// class everywhere in the codebase, so we use the standard emerald palette
// to stay self-contained and avoid theme-drift. Used for BOTH the top and
// bottom Save buttons so they read as the same canonical action.
const btnSavePrimary =
  'inline-flex items-center px-4 py-2 text-sm font-semibold rounded-lg border border-emerald-500/60 bg-emerald-600 text-white hover:bg-emerald-500 transition-colors shadow-sm'

export function MyGamesEditor({ rows }: { rows: GameRow[] }) {
  const router = useRouter()
  const [local, setLocal] = useState<LocalState>(() => {
    const m: LocalState = new Map()
    for (const r of rows) m.set(r.gameId, { view: r.view, ping: r.ping })
    return m
  })
  // `router.refresh()` after Save re-renders the server component with
  // fresh `rows` props, but `useState`'s initializer only runs once on
  // mount — without this effect the table would still show the pre-save
  // state until a hard reload. Re-sync whenever the parent hands us a
  // new rows snapshot (cheap: ~dozens of rows max).
  useEffect(() => {
    setLocal(() => {
      const m: LocalState = new Map()
      for (const r of rows) m.set(r.gameId, { view: r.view, ping: r.ping })
      return m
    })
  }, [rows])

  function setView(gameId: string, value: boolean) {
    setLocal((prev) => {
      const next = new Map(prev)
      const cur = next.get(gameId) ?? { view: false, ping: false }
      // Mirror the bot-side cascade: turning View off forces Ping off, so
      // the UI never shows an impossible combo.
      next.set(gameId, { view: value, ping: value ? cur.ping : false })
      return next
    })
  }

  function setPing(gameId: string, value: boolean) {
    setLocal((prev) => {
      const next = new Map(prev)
      const cur = next.get(gameId) ?? { view: false, ping: false }
      // Ping requires View. If the user somehow flips Ping on while View is
      // off (e.g. fast clicks), we silently enable View too — matches the
      // user's clear intent and avoids a confusing per-row error toast.
      next.set(gameId, { view: cur.view || value, ping: value })
      return next
    })
  }

  // Build the JSON payload the form will POST. <ServerForm> serializes a
  // hidden text input named `prefs` as a JSON string; the route handler
  // parses it back. This keeps us inside the existing ServerForm contract
  // without inventing a "JSON-by-attribute" mode.
  const prefsPayload = JSON.stringify(
    Array.from(local.entries()).map(([gameId, p]) => ({
      gameId,
      view: p.view,
      ping: p.ping,
    })),
  )

  return (
    <ServerForm
      action="/api/squishy/me/games"
      method="POST"
      onSuccess={() => router.refresh()}
      className="flex flex-col gap-4"
    >
      <input type="hidden" name="_format" value="json" />
      {/* The whole batch travels as one JSON-encoded field — the route
          handler parses it back into a typed array. */}
      <input type="hidden" name="prefs" value={prefsPayload} />

      {/* Top Save — same submit as the bottom one. Visually distinct
          (green) so a user editing a long list doesn't have to scroll
          back down to confirm. The fieldset[disabled] in ServerForm
          covers BOTH buttons during submit. */}
      <div className="flex items-center justify-between gap-3">
        <button type="submit" className={btnSavePrimary}>
          Save game prefs
        </button>
        <span className="text-[11px] text-ink-dim text-right">
          Changes apply on Discord immediately.
        </span>
      </div>

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
        <button type="submit" className={btnSavePrimary}>
          Save game prefs
        </button>
        <span className="text-[11px] text-ink-dim">
          Changes apply on Discord immediately. View must be on before Pings can be on.
        </span>
      </div>
    </ServerForm>
  )
}

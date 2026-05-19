'use client'

/**
 * Sudo write controls for /squishy/games.
 *
 * Three islands consumed by the server-rendered games page:
 *
 *   - `<AddGameForm />`         — top-of-page add form. POSTs to
 *                                 /api/squishy/games. Includes optional
 *                                 channelId / view roleId / pingRoleId /
 *                                 playCooldownSeconds / autoArchiveDays.
 *                                 When the "Auto-provision channel + view
 *                                 role + ping role" checkbox is checked,
 *                                 the form POSTs to
 *                                 /api/squishy/games/provision instead and
 *                                 the bot atomically creates all three
 *                                 Discord resources plus the games row.
 *   - `<EditGameForm />`        — collapsible inline editor on each row.
 *                                 PATCHes /api/squishy/games/[id]. Each
 *                                 unset link field grows an inline
 *                                 "+ Create" button that drives the new
 *                                 /api/squishy/discord/create-{role,channel}
 *                                 routes — on success it PATCHes the games
 *                                 row in-place and refreshes the page.
 *   - `<RemoveGameButton />`    — flip-to-confirm (two-stage) DELETE.
 *
 * All write surfaces go through `<ServerForm>` — see RolesWriteUI for the
 * full rundown of what that wrapper does (CSRF, JSON body, fieldset
 * disable, error banner). After every successful write we
 * `router.refresh()` so the server page re-runs its DB read and renders
 * the updated table; the bot-side cache refresh is handled API-side, so
 * we don't have to wait on it client-side.
 *
 * The new "+ Create" flow does its own CSRF dance via `requestJson()`
 * (a small fetch helper) rather than nesting forms — `<button>` inside
 * `<form>` would otherwise submit the outer form on click.
 */
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ServerForm } from '@/lib/forms/ServerForm'
import { ChannelPicker } from '@/components/pickers/ChannelPicker'
import { RolePicker } from '@/components/pickers/RolePicker'

const inputCls =
  'w-full rounded-md border border-line bg-bg-card2 px-2 py-1.5 text-sm placeholder:text-ink-dim/50 focus:outline-none focus:ring-1 focus:ring-accent'
const labelCls = 'text-[11px] uppercase tracking-wider text-ink-dim'
const btnPrimary =
  'inline-flex items-center px-3 py-1.5 text-sm rounded-lg border border-line bg-bg-card2 text-ink hover:bg-bg-card2/70 transition-colors'
const btnDanger =
  'inline-flex items-center px-2 py-1 text-xs rounded-md border border-err/40 bg-err/10 text-err hover:bg-err/20 transition-colors'
const btnGhost =
  'text-[11px] text-ink-dim hover:text-ink underline-offset-2 hover:underline'
const btnCreateInline =
  'inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded-md border border-accent/40 bg-accent/10 text-accent hover:bg-accent/20 transition-colors disabled:opacity-50'

// ---------------------------------------------------------------------------
// CSRF-aware fetch helper used by the inline "+ Create" buttons.
//
// `<ServerForm>` already encapsulates CSRF + JSON for the outer form posts;
// the inline buttons can't use that wrapper (they'd nest forms), so we
// reimplement the minimum here: lazy-fetch the CSRF token, POST JSON, parse
// the response, surface a simple {ok, data, error} shape. On 403 csrf we
// retry once with a fresh token — same recovery the wrapper does.
// ---------------------------------------------------------------------------

let cachedCsrfToken: string | null = null
async function getCsrfToken(): Promise<string | null> {
  if (cachedCsrfToken) return cachedCsrfToken
  try {
    const res = await fetch('/api/csrf', { credentials: 'same-origin' })
    if (!res.ok) return null
    const body = (await res.json()) as { token?: unknown }
    if (typeof body.token === 'string') {
      cachedCsrfToken = body.token
      return cachedCsrfToken
    }
  } catch {
    // fall through — caller renders the error
  }
  return null
}

async function requestJson<T = unknown>(
  url: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  body: unknown,
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const doFetch = async (token: string | null): Promise<Response> => {
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (token) headers['x-csrf-token'] = token
    return fetch(url, {
      method,
      headers,
      credentials: 'same-origin',
      body: JSON.stringify(body ?? {}),
    })
  }
  let token = await getCsrfToken()
  let res = await doFetch(token)
  if (res.status === 403) {
    // CSRF retry once with a freshly-fetched token.
    cachedCsrfToken = null
    token = await getCsrfToken()
    res = await doFetch(token)
  }
  let parsed: unknown = null
  try {
    parsed = await res.json()
  } catch {
    parsed = null
  }
  if (res.ok) {
    return { ok: true, data: (parsed as { data?: T })?.data ?? (parsed as T) }
  }
  const err =
    (parsed && typeof parsed === 'object' && typeof (parsed as { error?: unknown }).error === 'string'
      ? (parsed as { error: string }).error
      : null) ?? `Request failed (${res.status})`
  return { ok: false, error: err }
}

// ---------------------------------------------------------------------------
// "+ Create" inline action for unset role/channel links in the edit form.
//
// Shown only when the linked entity is missing (the parent decides this by
// checking whether the games row's column is null). The button prompts via
// the native `window.prompt()` for the new name (with a sensible default
// derived from the game's name), hits the panel `discord.create_{role,channel}`
// route, and on success PATCHes the games row to wire the returned id into
// the appropriate column, then `router.refresh()` so the page re-renders
// with the link populated.
// ---------------------------------------------------------------------------

type InlineCreateProps = {
  /** Game row id — needed for the follow-up PATCH that wires the new id in. */
  gameId: string
  /** "channel" → create-channel; "role" → create-role. */
  kind: 'channel' | 'role'
  /** Pre-filled prompt default + audit breadcrumb. */
  defaultName: string
  /** Which column on the games row this fills (`channelId` | `roleId` | `pingRoleId`). */
  patchField: 'channelId' | 'roleId' | 'pingRoleId'
  /** Parent category id for channels — only used when kind==='channel'. */
  parentId?: string | null
  /** UI label for the button — "+ Create channel" etc. */
  label: string
}

function InlineCreateButton({
  gameId,
  kind,
  defaultName,
  patchField,
  parentId,
  label,
}: InlineCreateProps) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        disabled={busy}
        className={btnCreateInline}
        onClick={async () => {
          if (busy) return
          setError(null)
          const promptLabel =
            kind === 'channel' ? 'New channel name:' : 'New role name:'
          const proposed = window.prompt(promptLabel, defaultName)
          if (proposed === null) return
          const name = proposed.trim()
          if (name.length === 0) {
            setError('Name cannot be empty.')
            return
          }
          setBusy(true)
          try {
            // 1) create the Discord resource via the new panel route.
            const createUrl =
              kind === 'channel'
                ? '/api/squishy/discord/create-channel'
                : '/api/squishy/discord/create-role'
            const createBody =
              kind === 'channel'
                ? { name, type: 'text', parentId: parentId ?? undefined }
                : { name }
            const created = await requestJson<{ id?: string }>(
              createUrl,
              'POST',
              createBody,
            )
            if (!created.ok) {
              setError(created.error)
              return
            }
            const newId = created.data?.id
            if (!newId || typeof newId !== 'string') {
              setError('Bot reply missing id — refresh and try again.')
              return
            }
            // 2) wire the id into the games row via the existing PATCH route.
            const patched = await requestJson(
              `/api/squishy/games/${gameId}`,
              'PATCH',
              { [patchField]: newId },
            )
            if (!patched.ok) {
              setError(`Discord ${kind} created, but linking it to the game failed: ${patched.error}`)
              return
            }
            // 3) refresh the server page so the row re-renders with the new link.
            router.refresh()
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Network error')
          } finally {
            setBusy(false)
          }
        }}
      >
        {busy ? 'Creating…' : label}
      </button>
      {error && (
        <p className="text-[11px] text-err">{error}</p>
      )}
    </div>
  )
}

/** Shared field set rendered by both Add (manual mode) and Edit forms. */
function GameFields({
  idPrefix,
  defaults,
  /**
   * Render the "+ Create" inline buttons next to each link picker when its
   * current value is empty (or, in Edit mode, when the linked entity is
   * known to be missing). Only used by `<EditGameForm>` — the Add form
   * builds new rows so there's nothing to fix yet.
   */
  inlineCreate,
  gameName,
  gamesCategoryId,
}: {
  idPrefix: string
  defaults?: {
    name?: string
    channelId?: string | null
    roleId?: string | null
    pingRoleId?: string | null
    playCooldownSeconds?: number | null
    autoArchiveDays?: number | null
  }
  inlineCreate?: {
    gameId: string
  }
  gameName?: string
  gamesCategoryId?: string | null
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <div className="flex flex-col gap-1 md:col-span-2">
        <label className={labelCls} htmlFor={`${idPrefix}-name`}>
          Name
        </label>
        <input
          id={`${idPrefix}-name`}
          name="name"
          type="text"
          required
          maxLength={100}
          defaultValue={defaults?.name ?? ''}
          placeholder="e.g. Overwatch"
          className={inputCls}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className={labelCls} htmlFor={`${idPrefix}-channelId`}>
          Channel (optional)
        </label>
        <ChannelPicker
          id={`${idPrefix}-channelId`}
          name="channelId"
          types={['text', 'announcement', 'forum']}
          defaultValue={defaults?.channelId ?? ''}
          allowNone
        />
        {inlineCreate && !defaults?.channelId && (
          <InlineCreateButton
            gameId={inlineCreate.gameId}
            kind="channel"
            defaultName={`🎮-${(gameName ?? defaults?.name ?? 'game').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}`}
            patchField="channelId"
            parentId={gamesCategoryId ?? null}
            label="+ Create channel"
          />
        )}
      </div>
      <div className="flex flex-col gap-1">
        <label className={labelCls} htmlFor={`${idPrefix}-roleId`}>
          View role (optional)
        </label>
        <RolePicker
          id={`${idPrefix}-roleId`}
          name="roleId"
          defaultValue={defaults?.roleId ?? ''}
          allowNone
        />
        {inlineCreate && !defaults?.roleId && (
          <InlineCreateButton
            gameId={inlineCreate.gameId}
            kind="role"
            defaultName={gameName ?? defaults?.name ?? 'Game'}
            patchField="roleId"
            label="+ Create view role"
          />
        )}
      </div>
      <div className="flex flex-col gap-1">
        <label className={labelCls} htmlFor={`${idPrefix}-pingRoleId`}>
          Ping role (optional)
        </label>
        <RolePicker
          id={`${idPrefix}-pingRoleId`}
          name="pingRoleId"
          defaultValue={defaults?.pingRoleId ?? ''}
          allowNone
        />
        {inlineCreate && !defaults?.pingRoleId && (
          <InlineCreateButton
            gameId={inlineCreate.gameId}
            kind="role"
            defaultName={`${gameName ?? defaults?.name ?? 'Game'} LFG`}
            patchField="pingRoleId"
            label="+ Create ping role"
          />
        )}
      </div>
      <div className="flex flex-col gap-1">
        <label className={labelCls} htmlFor={`${idPrefix}-playCooldownSeconds`}>
          /play cooldown (seconds, optional)
        </label>
        <input
          id={`${idPrefix}-playCooldownSeconds`}
          name="playCooldownSeconds"
          type="number"
          min={0}
          step={1}
          defaultValue={defaults?.playCooldownSeconds ?? ''}
          placeholder="1800"
          className={inputCls}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className={labelCls} htmlFor={`${idPrefix}-autoArchiveDays`}>
          Auto-archive (days, optional)
        </label>
        <input
          id={`${idPrefix}-autoArchiveDays`}
          name="autoArchiveDays"
          type="number"
          min={0}
          step={1}
          defaultValue={defaults?.autoArchiveDays ?? ''}
          placeholder="0 = off"
          className={inputCls}
        />
      </div>
    </div>
  )
}

/**
 * "Add game" form. Has two modes:
 *
 *   - **Manual** (default): renders the full set of optional pickers + ints
 *     and POSTs to /api/squishy/games. Same behaviour as before this change.
 *   - **Auto-provision** (checkbox on): hides the channel + role + cooldown
 *     pickers, leaves only the name + cooldown + auto-archive inputs, and
 *     POSTs to /api/squishy/games/provision instead. The bot creates the
 *     text channel + view role + ping role + games row atomically.
 *
 * The mode is local React state — the form doesn't try to remember it
 * across page reloads; sudo flips the box on the rare "creating a brand
 * new game from scratch" path, leaves it off for piggyback-on-existing-
 * channel games (which is most of them).
 */
export function AddGameForm({
  gamesCategoryId,
}: {
  gamesCategoryId?: string | null
} = {}) {
  const router = useRouter()
  const [autoProvision, setAutoProvision] = useState(false)
  // The two modes hit different routes; ServerForm reads `action` at render
  // time only (we pass it inline below), so we render two distinct forms
  // and only show one at a time. Keeps the action wiring simple.
  return (
    <div className="rounded-xl border border-line bg-bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium">Add game</h3>
        <span className="text-[11px] text-ink-dim">sudo · audit-logged</span>
      </div>
      <label className="flex items-start gap-2 mb-3 text-sm">
        <input
          type="checkbox"
          checked={autoProvision}
          onChange={(e) => setAutoProvision(e.target.checked)}
          className="mt-1"
        />
        <span className="flex flex-col">
          <span>Auto-provision channel + view role + ping role in #games category</span>
          <span className="text-[11px] text-ink-dim">
            Creates a fresh Discord channel (named <code className="font-mono text-xs">🎮-{'{name-slug}'}</code>, position 3 in the games category), a view role, and a ping role, then inserts the games row wired to all three. Leave unchecked for games that piggyback on an existing channel.
            {gamesCategoryId == null && (
              <>
                {' '}
                <span className="text-warn">
                  No games category set —{' '}
                  <code className="font-mono text-[10px]">channel.games_category</code>
                  {' '}is unset in bot_settings, so the new channel will be top-level.
                </span>
              </>
            )}
          </span>
        </span>
      </label>

      {autoProvision ? (
        <ServerForm
          action="/api/squishy/games/provision"
          method="POST"
          onSuccess={() => router.refresh()}
          className="flex flex-col gap-3"
        >
          <input type="hidden" name="_format" value="json" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1 md:col-span-2">
              <label className={labelCls} htmlFor="add-game-prov-name">
                Name
              </label>
              <input
                id="add-game-prov-name"
                name="name"
                type="text"
                required
                maxLength={100}
                placeholder="e.g. Cyberpunk"
                className={inputCls}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className={labelCls} htmlFor="add-game-prov-cooldown">
                /play cooldown (seconds, optional)
              </label>
              <input
                id="add-game-prov-cooldown"
                name="playCooldownSeconds"
                type="number"
                min={0}
                step={1}
                placeholder="1800"
                className={inputCls}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className={labelCls} htmlFor="add-game-prov-archive">
                Auto-archive (days, optional)
              </label>
              <input
                id="add-game-prov-archive"
                name="autoArchiveDays"
                type="number"
                min={0}
                step={1}
                placeholder="0 = off"
                className={inputCls}
              />
            </div>
          </div>
          <p className="text-[11px] text-ink-dim">
            On submit, the bot creates the Discord channel, view role, and ping
            role, then inserts the games row wired to all three IDs. Partial
            failures roll back what's already been created.
          </p>
          <div>
            <button type="submit" className={btnPrimary}>
              Auto-provision game
            </button>
          </div>
        </ServerForm>
      ) : (
        <ServerForm
          action="/api/squishy/games"
          method="POST"
          onSuccess={() => router.refresh()}
          className="flex flex-col gap-3"
        >
          <input type="hidden" name="_format" value="json" />
          <GameFields idPrefix="add-game" />
          <p className="text-[11px] text-ink-dim">
            Only <strong>name</strong> is required. The bot reads the games
            table live, and we ping its cache-refresh hook after the insert so
            /play and /games pick this row up immediately.
          </p>
          <div>
            <button type="submit" className={btnPrimary}>
              Add game
            </button>
          </div>
        </ServerForm>
      )}
    </div>
  )
}

export function EditGameForm({
  id,
  name,
  channelId,
  roleId,
  pingRoleId,
  playCooldownSeconds,
  autoArchiveDays,
  gamesCategoryId,
}: {
  id: string
  name: string
  channelId: string | null
  roleId: string | null
  pingRoleId: string | null
  playCooldownSeconds: number | null
  autoArchiveDays: number | null
  gamesCategoryId?: string | null
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-[11px] text-accent hover:underline"
      >
        Edit
      </button>
    )
  }
  return (
    <div className="flex flex-col gap-2 mt-2 rounded-md border border-line bg-bg-card2 p-3">
      <ServerForm
        action={`/api/squishy/games/${id}`}
        method="PATCH"
        onSuccess={() => {
          setOpen(false)
          router.refresh()
        }}
        className="flex flex-col gap-3"
      >
        <input type="hidden" name="_format" value="json" />
        <GameFields
          idPrefix={`edit-${id}`}
          defaults={{
            name,
            channelId,
            roleId,
            pingRoleId,
            playCooldownSeconds,
            autoArchiveDays,
          }}
          inlineCreate={{ gameId: id }}
          gameName={name}
          gamesCategoryId={gamesCategoryId}
        />
        <p className="text-[11px] text-ink-dim">
          Pick &quot;— None —&quot; or clear a number field to unset it. The &quot;+ Create&quot;
          buttons next to an empty link create a fresh Discord resource and
          link it in one shot. Saving fires the bot cache-refresh hook.
        </p>
        <div className="flex items-center gap-2">
          <button type="submit" className={btnPrimary}>
            Save
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className={btnGhost}
          >
            Cancel
          </button>
        </div>
      </ServerForm>
    </div>
  )
}

/**
 * Flip-to-confirm remove. First click swaps to a red "Confirm remove" +
 * Cancel pair; second click submits the DELETE. A timeout reverts to the
 * pre-flip state so a forgotten click can't be turned into a delete later.
 */
export function RemoveGameButton({ id, name }: { id: string; name: string }) {
  const router = useRouter()
  const [armed, setArmed] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Auto-revert after 4s so a forgotten click doesn't sit armed forever.
  useEffect(() => {
    if (!armed) return
    timerRef.current = setTimeout(() => setArmed(false), 4000)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [armed])

  if (!armed) {
    return (
      <button
        type="button"
        onClick={() => setArmed(true)}
        className={btnDanger}
        title={`Remove ${name}`}
      >
        Remove
      </button>
    )
  }

  return (
    <span className="inline-flex items-center gap-1">
      <ServerForm
        action={`/api/squishy/games/${id}`}
        method="DELETE"
        onSuccess={() => {
          setArmed(false)
          router.refresh()
        }}
        className="inline"
      >
        <button type="submit" className={btnDanger}>
          Confirm remove
        </button>
      </ServerForm>
      <button
        type="button"
        onClick={() => setArmed(false)}
        className={btnGhost}
      >
        Cancel
      </button>
    </span>
  )
}

// ---------------------------------------------------------------------------
// <PostLfgButton /> — panel-side trigger for /play.
//
// Mirrors the slash command's [message] + [ping] options. The actual LFG
// panel is built + sent by squishybot (so it's byte-identical to the
// slash version with Help / Notify Toggle buttons and all). We just POST
// to /api/squishy/play with gameId + optional message + ping flag.
//
// UX: collapsed button until clicked; click → small inline panel with
// textarea + checkbox + Post / Cancel. After a successful POST the
// inline form auto-closes and shows a one-line confirmation with the
// channel ID; on error it shows a red banner with the bot's error
// token (cooldown surfaces remainingSec as a friendly wait time).
// ---------------------------------------------------------------------------

const btnPost =
  'inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md border border-accent/40 bg-accent/10 text-accent hover:bg-accent/20 transition-colors disabled:opacity-50'

function formatWait(remainingSec: number): string {
  const m = Math.floor(remainingSec / 60)
  const s = remainingSec % 60
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

function localizePlayError(err: string, remainingSec?: number): string {
  switch (err) {
    case 'cooldown':
      return remainingSec
        ? `🕒 Cooldown — try again in ${formatWait(remainingSec)}.`
        : '🕒 You ran /play for this game too recently. Try again later.'
    case 'game-not-active':
      return '❌ This game is archived or hidden — can\'t LFG it right now.'
    case 'game-no-channel':
      return '❌ This game has no channel configured. Set one in the editor first.'
    case 'channel-unreachable':
    case 'channel-not-text':
      return '❌ The game\'s channel is unreachable or not a text channel.'
    case 'bot-missing-perm':
      return '❌ Bot is missing Send Messages in the game\'s channel.'
    case 'rpc-not-configured':
    case 'timeout':
      return '❌ Bot is offline or RPC is misconfigured. Try again in a minute.'
    case 'message-too-long':
      return '❌ Message is too long (500 char max).'
    case 'game-not-found':
      return '❌ Game not found — was it just removed?'
    case 'guild-unavailable':
      return '❌ Guild unavailable — bot may be reconnecting.'
    default:
      return `❌ ${err}`
  }
}

export function PostLfgButton({ gameId, gameName }: { gameId: string; gameName: string }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [ping, setPing] = useState(true)
  const [result, setResult] = useState<
    | { kind: 'ok'; messageId: string; channelId: string }
    | { kind: 'err'; text: string }
    | null
  >(null)

  async function submit() {
    if (busy) return
    setBusy(true)
    setResult(null)
    const trimmed = message.trim()
    const body = { gameId, ping, ...(trimmed ? { message: trimmed } : {}) }
    const res = await requestJson<{ channelId?: string; messageId?: string }>(
      '/api/squishy/play',
      'POST',
      body,
    )
    if (res.ok) {
      const data = res.data ?? {}
      setResult({
        kind: 'ok',
        messageId: data.messageId ?? '',
        channelId: data.channelId ?? '',
      })
      setMessage('')
      setPing(true)
      // Auto-collapse the form after a short delay so the success line lingers.
      setTimeout(() => setOpen(false), 1500)
    } else {
      // requestJson returns the API's `error` token in res.error; remainingSec
      // is on the actual response body which we don't surface through that
      // helper. Re-fetching just to read it is overkill — use the textual
      // fallback when the cooldown token comes through without seconds.
      setResult({ kind: 'err', text: localizePlayError(res.error) })
    }
    setBusy(false)
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={btnPost}
        title={`Post LFG for ${gameName}`}
      >
        📣 Post LFG
      </button>
    )
  }

  return (
    <div className="flex flex-col gap-2 min-w-[16rem] p-2 rounded-lg border border-accent/30 bg-bg-card2 text-left">
      <div className="text-[11px] uppercase tracking-wider text-ink-dim">
        Post LFG — {gameName}
      </div>
      <textarea
        rows={2}
        maxLength={500}
        placeholder="Optional message (e.g. casual 1hr, no mic)"
        className={`${inputCls} resize-none`}
        value={message}
        onChange={e => setMessage(e.target.value)}
        disabled={busy}
      />
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={ping}
          onChange={e => setPing(e.target.checked)}
          disabled={busy}
        />
        <span>Ping the game role</span>
      </label>
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className={btnPost}
        >
          {busy ? 'Posting…' : '📣 Post'}
        </button>
        <button
          type="button"
          onClick={() => { setOpen(false); setResult(null) }}
          disabled={busy}
          className={btnGhost}
        >
          Cancel
        </button>
      </div>
      {result?.kind === 'ok' && (
        <p className="text-[11px] text-ok">✅ Posted in channel <span className="font-mono">{result.channelId}</span></p>
      )}
      {result?.kind === 'err' && (
        <p className="text-[11px] text-err">{result.text}</p>
      )}
    </div>
  )
}

'use client'

/**
 * Sudo write controls for /squishy/roles.
 *
 * All write surfaces here go through `<ServerForm>` (`@/lib/forms/ServerForm`),
 * which:
 *   - injects the double-submit CSRF token on every POST/PUT/PATCH/DELETE,
 *   - swaps the body to JSON when a hidden `<input name="_format" value="json">`
 *     is present (every form here opts in),
 *   - disables the fieldset while submitting and surfaces 4xx `error` bodies
 *     in a red banner above the form.
 *
 * The page is a server component, so after every successful write we want
 * to re-fetch the table data. ServerForm doesn't auto-`router.refresh()`
 * (its design hands navigation to the caller), so each form here passes an
 * `onSuccess={() => router.refresh()}` callback.
 *
 * Exports:
 *   - `<AddAutoJoinForm />`         — top-of-tab add form on the join tab.
 *   - `<RemoveAutoJoinButton />`    — per-row remove.
 *   - `<AddColorRoleForm />`        — top-of-tab add form on the color tab.
 *   - `<EditColorRoleForm />`       — collapsible per-card label/sortOrder editor.
 *   - `<RemoveColorRoleButton />`   — per-card remove.
 *   - `<CreateReactionRoleForm />`  — Wave 7b builder for new reaction-role
 *     messages. Bespoke fetch flow (rather than `<ServerForm>`) because the
 *     payload carries a dynamic `mappings[]` array — `ServerForm`'s FormData
 *     → flat-object collapse can't faithfully represent it. Handles its own
 *     CSRF token fetch, error banner, and submit disabling.
 *   - `<DeleteReactionRoleButton />`— flip-to-confirm per-card delete button.
 */
import { useRouter } from 'next/navigation'
import { useCallback, useState } from 'react'
import { ServerForm } from '@/lib/forms/ServerForm'

const inputCls =
  'w-full rounded-md border border-line bg-bg-card2 px-2 py-1.5 text-sm placeholder:text-ink-dim/50 focus:outline-none focus:ring-1 focus:ring-accent'
const labelCls = 'text-[11px] uppercase tracking-wider text-ink-dim'
const btnPrimary =
  'inline-flex items-center px-3 py-1.5 text-sm rounded-lg border border-line bg-bg-card2 text-ink hover:bg-bg-card2/70 transition-colors'
const btnDanger =
  'inline-flex items-center px-2 py-1 text-xs rounded-md border border-err/40 bg-err/10 text-err hover:bg-err/20 transition-colors'
const btnGhost =
  'text-[11px] text-ink-dim hover:text-ink underline-offset-2 hover:underline self-start'

export function AddAutoJoinForm() {
  const router = useRouter()
  return (
    <div className="rounded-xl border border-line bg-bg-card p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium">Add auto-join role</h3>
        <span className="text-[11px] text-ink-dim">sudo · audit-logged</span>
      </div>
      <ServerForm
        action="/api/squishy/auto-join-roles"
        method="POST"
        onSuccess={() => router.refresh()}
        className="flex flex-col gap-2"
      >
        <input type="hidden" name="_format" value="json" />
        <label className={labelCls} htmlFor="ajr-roleId">
          Role ID
        </label>
        <input
          id="ajr-roleId"
          name="roleId"
          type="text"
          required
          inputMode="numeric"
          pattern="\d{15,25}"
          placeholder="e.g. 123456789012345678"
          className={inputCls}
        />
        <p className="text-[11px] text-ink-dim">
          Discord role snowflake (15–25 digits). The bot applies this role on
          every new join while{' '}
          <code className="font-mono">feature.auto_role_on_join</code> is on.
        </p>
        <div>
          <button type="submit" className={btnPrimary}>
            Add role
          </button>
        </div>
      </ServerForm>
    </div>
  )
}

export function RemoveAutoJoinButton({ roleId }: { roleId: string }) {
  const router = useRouter()
  return (
    <ServerForm
      action={`/api/squishy/auto-join-roles/${roleId}`}
      method="DELETE"
      onSuccess={() => router.refresh()}
      className="inline"
    >
      <button
        type="submit"
        className={btnDanger}
        onClick={(e) => {
          if (!window.confirm(`Remove auto-join role ${roleId}?`)) {
            e.preventDefault()
          }
        }}
      >
        Remove
      </button>
    </ServerForm>
  )
}

export function AddColorRoleForm() {
  const router = useRouter()
  return (
    <div className="rounded-xl border border-line bg-bg-card p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium">Add color role</h3>
        <span className="text-[11px] text-ink-dim">sudo · audit-logged</span>
      </div>
      <ServerForm
        action="/api/squishy/color-roles"
        method="POST"
        onSuccess={() => router.refresh()}
        className="flex flex-col gap-2"
      >
        <input type="hidden" name="_format" value="json" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="flex flex-col gap-1">
            <label className={labelCls} htmlFor="cr-roleId">
              Role ID
            </label>
            <input
              id="cr-roleId"
              name="roleId"
              type="text"
              required
              inputMode="numeric"
              pattern="\d{15,25}"
              placeholder="123456789012345678"
              className={inputCls}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className={labelCls} htmlFor="cr-label">
              Label (optional)
            </label>
            <input
              id="cr-label"
              name="label"
              type="text"
              maxLength={100}
              placeholder="e.g. Cherry"
              className={inputCls}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className={labelCls} htmlFor="cr-sortOrder">
              Sort order (optional)
            </label>
            <input
              id="cr-sortOrder"
              name="sortOrder"
              type="number"
              step={1}
              placeholder="0"
              className={inputCls}
            />
          </div>
        </div>
        <p className="text-[11px] text-ink-dim">
          Re-posting an existing role ID updates label / sort order instead of
          409&apos;ing. Hex color lives on the Discord role itself — not stored
          here.
        </p>
        <div>
          <button type="submit" className={btnPrimary}>
            Add color
          </button>
        </div>
      </ServerForm>
    </div>
  )
}

export function EditColorRoleForm({
  roleId,
  label,
  sortOrder,
}: {
  roleId: string
  label: string
  sortOrder: number
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-[11px] text-accent hover:underline self-start"
      >
        Edit label
      </button>
    )
  }
  return (
    <div className="flex flex-col gap-2 mt-1 rounded-md border border-line bg-bg-card2 p-2">
      <ServerForm
        action={`/api/squishy/color-roles/${roleId}`}
        method="PATCH"
        onSuccess={() => {
          setOpen(false)
          router.refresh()
        }}
        className="flex flex-col gap-2"
      >
        <input type="hidden" name="_format" value="json" />
        <div className="flex flex-col gap-1">
          <label className={labelCls} htmlFor={`cr-edit-label-${roleId}`}>
            Label
          </label>
          <input
            id={`cr-edit-label-${roleId}`}
            name="label"
            type="text"
            defaultValue={label}
            maxLength={100}
            className={inputCls}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className={labelCls} htmlFor={`cr-edit-sort-${roleId}`}>
            Sort order
          </label>
          <input
            id={`cr-edit-sort-${roleId}`}
            name="sortOrder"
            type="number"
            step={1}
            defaultValue={sortOrder}
            className={inputCls}
          />
        </div>
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

export function RemoveColorRoleButton({ roleId }: { roleId: string }) {
  const router = useRouter()
  return (
    <ServerForm
      action={`/api/squishy/color-roles/${roleId}`}
      method="DELETE"
      onSuccess={() => router.refresh()}
      className="inline"
    >
      <button
        type="submit"
        className={btnDanger}
        onClick={(e) => {
          if (!window.confirm(`Remove color role ${roleId}?`)) {
            e.preventDefault()
          }
        }}
      >
        Remove
      </button>
    </ServerForm>
  )
}

// ─── Reaction-role builder (Wave 7b) ─────────────────────────────────
// Bespoke fetch flow rather than <ServerForm> because the payload
// carries a dynamic `mappings[]` array; ServerForm flattens FormData
// to a single object per submit and can't faithfully represent it.
// We mirror ServerForm's CSRF approach (GET /api/csrf once, attach
// `x-csrf-token` header) and surface 4xx/5xx errors as an inline
// banner above the form.

async function fetchCsrfToken(): Promise<string | null> {
  try {
    const res = await fetch('/api/csrf', {
      method: 'GET',
      credentials: 'same-origin',
    })
    if (!res.ok) return null
    const body = (await res.json()) as { token?: unknown }
    return typeof body.token === 'string' ? body.token : null
  } catch {
    return null
  }
}

type DraftMapping = { emoji: string; roleId: string }

const SNOWFLAKE_RE = /^\d{15,25}$/
const MIN_MAPPINGS = 1
const MAX_MAPPINGS = 20
const MAX_BODY_LEN = 2000
const MAX_EXPIRES_MIN = 60 * 24 * 30

function newDraftMapping(): DraftMapping {
  return { emoji: '', roleId: '' }
}

export function CreateReactionRoleForm() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [channelId, setChannelId] = useState('')
  const [body, setBody] = useState('')
  const [mappings, setMappings] = useState<DraftMapping[]>([newDraftMapping()])
  const [isTemporary, setIsTemporary] = useState(false)
  const [expiresInMinutes, setExpiresInMinutes] = useState('60')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reset = useCallback(() => {
    setChannelId('')
    setBody('')
    setMappings([newDraftMapping()])
    setIsTemporary(false)
    setExpiresInMinutes('60')
    setError(null)
  }, [])

  // Cheap client-side gate. The API revalidates everything — we just
  // want to fail fast on obvious shape errors instead of a round-trip.
  const validate = (): string | null => {
    if (!SNOWFLAKE_RE.test(channelId.trim())) {
      return 'Channel ID must be a Discord snowflake (15-25 digits).'
    }
    if (body.trim() === '') return 'Message body is required.'
    if (body.length > MAX_BODY_LEN) return `Body too long (max ${MAX_BODY_LEN}).`
    if (mappings.length < MIN_MAPPINGS || mappings.length > MAX_MAPPINGS) {
      return `Need ${MIN_MAPPINGS}..${MAX_MAPPINGS} mappings.`
    }
    for (let i = 0; i < mappings.length; i++) {
      const m = mappings[i]
      if (!m.emoji.trim()) return `Mapping #${i + 1}: emoji is required.`
      if (!SNOWFLAKE_RE.test(m.roleId.trim())) {
        return `Mapping #${i + 1}: roleId must be a Discord snowflake.`
      }
    }
    if (isTemporary) {
      const n = Number(expiresInMinutes)
      if (
        !Number.isFinite(n) ||
        !Number.isInteger(n) ||
        n < 1 ||
        n > MAX_EXPIRES_MIN
      ) {
        return `Expires must be an integer 1..${MAX_EXPIRES_MIN} minutes.`
      }
    }
    return null
  }

  const onSubmit = async (ev: React.FormEvent<HTMLFormElement>) => {
    ev.preventDefault()
    if (submitting) return
    const v = validate()
    if (v) {
      setError(v)
      return
    }
    setError(null)
    setSubmitting(true)
    try {
      const token = await fetchCsrfToken()
      const headers: Record<string, string> = {
        'content-type': 'application/json',
      }
      if (token) headers['x-csrf-token'] = token

      const payload = {
        channelId: channelId.trim(),
        body,
        mappings: mappings.map((m) => ({
          emoji: m.emoji.trim(),
          roleId: m.roleId.trim(),
        })),
        isTemporary,
        ...(isTemporary
          ? { expiresInMinutes: Number(expiresInMinutes) }
          : {}),
      }
      const res = await fetch('/api/squishy/reaction-roles', {
        method: 'POST',
        headers,
        credentials: 'same-origin',
        body: JSON.stringify(payload),
      })
      let parsed: unknown = null
      try {
        parsed = await res.json()
      } catch {
        // leave parsed null
      }

      if (!res.ok) {
        const msg =
          (parsed &&
            typeof parsed === 'object' &&
            typeof (parsed as { error?: unknown }).error === 'string' &&
            (parsed as { error: string }).error) ||
          `Request failed (${res.status})`
        setError(msg)
        return
      }

      reset()
      setOpen(false)
      // Push to the reaction tab so the newly-created message shows up
      // (loadReactionMessages re-runs on navigation to a dynamic page).
      router.push('/squishy/roles?tab=reaction')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) {
    return (
      <div className="rounded-xl border border-line bg-bg-card p-4 flex items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h3 className="text-sm font-medium">
            Create reaction-role message
          </h3>
          <p className="text-[11px] text-ink-dim">
            Posts a new Discord message + watches it for reactions. Sudo only.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={btnPrimary}
        >
          New message
        </button>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-line bg-bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium">Create reaction-role message</h3>
        <span className="text-[11px] text-ink-dim">sudo · audit-logged</span>
      </div>
      <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
        {error && (
          <div
            role="alert"
            className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200"
          >
            {error}
          </div>
        )}
        <fieldset disabled={submitting} className="contents">
          <div className="flex flex-col gap-1">
            <label className={labelCls} htmlFor="rxn-channelId">
              Channel ID
            </label>
            <input
              id="rxn-channelId"
              type="text"
              required
              inputMode="numeric"
              pattern="\d{15,25}"
              placeholder="123456789012345678"
              className={inputCls}
              value={channelId}
              onChange={(e) => setChannelId(e.target.value)}
            />
            <p className="text-[11px] text-ink-dim">
              Discord text-channel snowflake. Channel picker arrives in Wave 7d.
            </p>
          </div>

          <div className="flex flex-col gap-1">
            <label className={labelCls} htmlFor="rxn-body">
              Body
            </label>
            <textarea
              id="rxn-body"
              required
              maxLength={MAX_BODY_LEN}
              rows={5}
              className={`${inputCls} resize-y`}
              placeholder="Click an emoji below to pick up a role."
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
            <p className="text-[11px] text-ink-dim">
              The message users see. Up to {MAX_BODY_LEN} chars; mentions are
              stripped by the bot.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className={labelCls}>
                Mappings ({mappings.length}/{MAX_MAPPINGS})
              </span>
              <button
                type="button"
                onClick={() => {
                  if (mappings.length >= MAX_MAPPINGS) return
                  setMappings([...mappings, newDraftMapping()])
                }}
                disabled={mappings.length >= MAX_MAPPINGS}
                className={btnGhost}
              >
                + Add mapping
              </button>
            </div>
            {mappings.map((m, i) => (
              <div
                key={i}
                className="grid grid-cols-[1fr_2fr_auto] gap-2 items-center"
              >
                <input
                  type="text"
                  placeholder="🟢 or <:name:id>"
                  className={inputCls}
                  value={m.emoji}
                  onChange={(e) => {
                    const next = mappings.slice()
                    next[i] = { ...next[i], emoji: e.target.value }
                    setMappings(next)
                  }}
                  aria-label={`Mapping ${i + 1} emoji`}
                />
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="\d{15,25}"
                  placeholder="role ID (snowflake)"
                  className={inputCls}
                  value={m.roleId}
                  onChange={(e) => {
                    const next = mappings.slice()
                    next[i] = { ...next[i], roleId: e.target.value }
                    setMappings(next)
                  }}
                  aria-label={`Mapping ${i + 1} role ID`}
                />
                <button
                  type="button"
                  onClick={() => {
                    if (mappings.length <= MIN_MAPPINGS) return
                    setMappings(mappings.filter((_, j) => j !== i))
                  }}
                  disabled={mappings.length <= MIN_MAPPINGS}
                  className={btnDanger}
                  aria-label={`Remove mapping ${i + 1}`}
                  title={
                    mappings.length <= MIN_MAPPINGS
                      ? `At least ${MIN_MAPPINGS} mapping required`
                      : 'Remove mapping'
                  }
                >
                  ✕
                </button>
              </div>
            ))}
            <p className="text-[11px] text-ink-dim">
              Each row: one emoji (unicode or full <code>&lt;:name:id&gt;</code>)
              and the role ID to toggle when a member reacts.
            </p>
          </div>

          <div className="flex flex-col gap-2 rounded-md border border-line bg-bg-card2 p-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isTemporary}
                onChange={(e) => setIsTemporary(e.target.checked)}
              />
              <span>Temporary (auto-expires)</span>
            </label>
            {isTemporary && (
              <div className="flex flex-col gap-1">
                <label className={labelCls} htmlFor="rxn-expires">
                  Expires in N minutes
                </label>
                <input
                  id="rxn-expires"
                  type="number"
                  step={1}
                  min={1}
                  max={MAX_EXPIRES_MIN}
                  className={inputCls}
                  value={expiresInMinutes}
                  onChange={(e) => setExpiresInMinutes(e.target.value)}
                />
                <p className="text-[11px] text-ink-dim">
                  1..{MAX_EXPIRES_MIN} (= 30 days). On expiry the bot deletes
                  the message and strips granted roles.
                </p>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button type="submit" className={btnPrimary}>
              {submitting ? 'Creating…' : 'Create message'}
            </button>
            <button
              type="button"
              onClick={() => {
                reset()
                setOpen(false)
              }}
              className={btnGhost}
            >
              Cancel
            </button>
          </div>
        </fieldset>
      </form>
    </div>
  )
}

/**
 * Flip-to-confirm delete button for the per-message reaction-role card.
 * First click swaps the button into a "Confirm delete" / "Cancel" pair —
 * a second confirm-click fires the POST. Avoids `window.confirm()` which
 * is jarring on a dashboard and easy to muscle-memory through.
 */
export function DeleteReactionRoleButton({ id }: { id: string }) {
  const router = useRouter()
  const [armed, setArmed] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onDelete = async () => {
    if (submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const token = await fetchCsrfToken()
      const headers: Record<string, string> = {}
      if (token) headers['x-csrf-token'] = token
      const res = await fetch(`/api/squishy/reaction-roles/${id}/delete`, {
        method: 'POST',
        headers,
        credentials: 'same-origin',
      })
      if (!res.ok) {
        let msg = `Request failed (${res.status})`
        try {
          const parsed = await res.json()
          if (parsed && typeof parsed === 'object') {
            const e = (parsed as { error?: unknown }).error
            if (typeof e === 'string') msg = e
          }
        } catch {
          // leave default msg
        }
        setError(msg)
        return
      }
      setArmed(false)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setSubmitting(false)
    }
  }

  if (!armed) {
    return (
      <button
        type="button"
        onClick={() => {
          setError(null)
          setArmed(true)
        }}
        className={btnDanger}
        title="Delete this reaction-role message"
      >
        Delete message
      </button>
    )
  }
  return (
    <div className="flex items-center gap-2">
      {error && (
        <span className="text-xs text-err" role="alert">
          {error}
        </span>
      )}
      <button
        type="button"
        onClick={onDelete}
        disabled={submitting}
        className={btnDanger}
      >
        {submitting ? 'Deleting…' : 'Confirm delete'}
      </button>
      <button
        type="button"
        onClick={() => {
          setArmed(false)
          setError(null)
        }}
        disabled={submitting}
        className={btnGhost}
      >
        Cancel
      </button>
    </div>
  )
}

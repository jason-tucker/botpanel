'use client'

/**
 * `<WelcomeEditor>` — single-column editor for one kind (`welcome` or
 * `goodbye`). Used twice on the `/squishy/welcome` page.
 *
 * The three save forms (enabled / channel_id / template) each PUT to the
 * existing `/api/squishy/settings/<key>` endpoint via `<ServerForm>`. We
 * deliberately keep them separate forms — saving the toggle without
 * touching the template is the common case, and bundling them would mean
 * one form-submit changes three rows (and three audit entries) every
 * time. The settings PUT route writes one row, audits one row; we match
 * that semantic.
 *
 * **Preview** is a separate POST to `/api/squishy/welcome/preview` (not a
 * `<ServerForm>` because we want to render the rendered string into local
 * state instead of relying on its onSuccess + a refresh). It calls the
 * bot's `welcome.preview` verb with the current viewer's user ID — the
 * bot uses that to substitute `{user}` and `{account_age}` so the preview
 * matches what a real join would look like for the operator.
 *
 * Preview is **read-only on the bot side** — the verb explicitly does not
 * post to the configured channel. The "Live posting still owns the real
 * join/leave message" note in the help text says so out loud so an
 * operator doesn't worry about double-posts.
 *
 * The toggle uses the same JSON-PUT semantics the settings table uses —
 * `value: "true" | "false"` (string), since `bot_settings.value` is a
 * NOT-NULL text column and `getBoolSetting` parses the string back to a
 * bool. We rely on `router.refresh()` after each save so the server re-
 * reads the row and the displayed defaults stay accurate after a redirect-
 * less submit.
 */
import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ServerForm } from '@/lib/forms/ServerForm'

type Kind = 'welcome' | 'goodbye'

type Reply =
  | { ok: true; data: { rendered: string; kind: Kind; templateKey: string; usingDefault: boolean } }
  | { ok: false; error: string; details?: unknown }

interface PreviewApiResponse {
  reply?: Reply
}

const DEFAULTS: Record<Kind, string> = {
  welcome: "👋 Welcome {user} to {server}! We're now at {member_count} members.",
  goodbye: "👋 {user} has left {server}. We're now at {member_count} members.",
}

const LABELS: Record<Kind, { title: string; accent: string }> = {
  welcome: { title: 'Welcome', accent: 'text-ok' },
  goodbye: { title: 'Goodbye', accent: 'text-warn' },
}

export function WelcomeEditor({
  kind,
  enabled,
  channelId,
  template,
}: {
  kind: Kind
  enabled: boolean
  channelId: string
  template: string
}) {
  const router = useRouter()
  const onSavedSetting = useCallback(() => {
    // Re-read server-side state after every save so the next render shows
    // the persisted value (and the `usingDefault` flag in the preview card
    // stays accurate).
    router.refresh()
  }, [router])

  const [preview, setPreview] = useState<Reply | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)

  const onPreview = useCallback(async () => {
    setPreviewLoading(true)
    setPreviewError(null)
    try {
      // Re-use the global CSRF flow indirectly: `/api/csrf` already lives in
      // the page bundle thanks to other `<ServerForm>` instances. We fetch
      // a token here too — small duplication, but means the Preview button
      // doesn't depend on a form having been submitted first.
      const tokenRes = await fetch('/api/csrf', { credentials: 'same-origin' })
      const token = tokenRes.ok
        ? ((await tokenRes.json()) as { token?: string }).token ?? null
        : null
      const headers: Record<string, string> = { 'content-type': 'application/json' }
      if (token) headers['x-csrf-token'] = token
      const res = await fetch('/api/squishy/welcome/preview', {
        method: 'POST',
        headers,
        credentials: 'same-origin',
        body: JSON.stringify({ kind }),
      })
      const body = (await res.json().catch(() => null)) as PreviewApiResponse | { error?: string } | null
      if (!res.ok) {
        const errMsg =
          (body as { error?: unknown } | null)?.error
          ?? `HTTP ${res.status}`
        setPreviewError(typeof errMsg === 'string' ? errMsg : 'preview failed')
        return
      }
      const reply = (body as PreviewApiResponse).reply
      if (reply && typeof reply === 'object' && 'ok' in reply) {
        setPreview(reply as Reply)
      } else {
        setPreview({ ok: false, error: 'bad-reply', details: body })
      }
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : 'network error')
    } finally {
      setPreviewLoading(false)
    }
  }, [kind])

  const enabledKey = `${kind}.enabled`
  const channelKey = `${kind}.channel_id`
  const templateKey = `${kind}.template`
  const { title, accent } = LABELS[kind]

  return (
    <section className="rounded-xl border border-line bg-bg-card overflow-hidden flex flex-col">
      <header className="px-4 py-3 border-b border-line bg-bg-card2/40">
        <h2 className={`text-lg font-semibold ${accent}`}>{title}</h2>
        <p className="text-xs text-ink-dim">
          Edits <code className="font-mono">{enabledKey}</code> /{' '}
          <code className="font-mono">{channelKey}</code> /{' '}
          <code className="font-mono">{templateKey}</code> in{' '}
          <code className="font-mono">bot_settings</code>.
        </p>
      </header>

      <div className="p-4 flex flex-col gap-5">
        {/* Toggle */}
        <ServerForm
          action={`/api/squishy/settings/${encodeURIComponent(enabledKey)}`}
          method="PUT"
          onSuccess={onSavedSetting}
          className="flex flex-col gap-2"
        >
          <label className="text-xs uppercase tracking-wider text-ink-dim">
            Enabled
          </label>
          <div className="flex items-center gap-3">
            {/* Two hidden radio-as-checkbox to send `value: "true"|"false"`
                regardless of native checkbox semantics (unchecked checkboxes
                aren't submitted at all). */}
            <label className="inline-flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                name="__enabled"
                defaultChecked={enabled}
                onChange={(e) => {
                  const form = e.currentTarget.form
                  if (!form) return
                  const hidden = form.elements.namedItem('value') as HTMLInputElement | null
                  if (hidden) hidden.value = e.currentTarget.checked ? 'true' : 'false'
                }}
              />
              <span>{`Post on member ${kind === 'welcome' ? 'join' : 'leave'}`}</span>
            </label>
            <input type="hidden" name="value" defaultValue={enabled ? 'true' : 'false'} />
            <button
              type="submit"
              className="ml-auto rounded border border-line bg-bg-card2 px-3 py-1 text-xs text-ink hover:bg-bg-card"
            >
              Save
            </button>
          </div>
        </ServerForm>

        {/* Channel ID */}
        <ServerForm
          action={`/api/squishy/settings/${encodeURIComponent(channelKey)}`}
          method="PUT"
          onSuccess={onSavedSetting}
          className="flex flex-col gap-2"
        >
          <label className="text-xs uppercase tracking-wider text-ink-dim">
            Channel ID
          </label>
          <p className="text-xs text-ink-dim">
            Discord channel snowflake. A proper channel picker arrives in
            Wave 7d — for now paste the ID from Discord (Settings →
            Advanced → Developer Mode, then right-click channel → Copy ID).
          </p>
          <div className="flex items-center gap-2">
            <input
              type="text"
              name="value"
              defaultValue={channelId}
              placeholder="e.g. 123456789012345678"
              pattern="\d{17,20}"
              className="flex-1 rounded border border-line bg-bg-card2 px-2 py-1 font-mono text-xs text-ink focus:outline-none focus:ring-1 focus:ring-accent"
            />
            <button
              type="submit"
              className="rounded border border-line bg-bg-card2 px-3 py-1 text-xs text-ink hover:bg-bg-card"
            >
              Save
            </button>
          </div>
        </ServerForm>

        {/* Template body */}
        <ServerForm
          action={`/api/squishy/settings/${encodeURIComponent(templateKey)}`}
          method="PUT"
          onSuccess={onSavedSetting}
          className="flex flex-col gap-2"
        >
          <label className="text-xs uppercase tracking-wider text-ink-dim">
            Body
          </label>
          <p className="text-xs text-ink-dim">
            Tokens: <code className="font-mono">{'{user}'}</code>{' '}
            <code className="font-mono">{'{server}'}</code>{' '}
            <code className="font-mono">{'{member_count}'}</code>{' '}
            <code className="font-mono">{'{account_age}'}</code>. Max 2000
            chars (Discord cap). Leave blank to fall back to the bot's
            built-in default.
          </p>
          <textarea
            name="value"
            defaultValue={template || DEFAULTS[kind]}
            rows={4}
            maxLength={2000}
            className="w-full rounded border border-line bg-bg-card2 px-2 py-1 font-mono text-xs text-ink focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <div className="flex items-center gap-2">
            <button
              type="submit"
              className="rounded border border-line bg-bg-card2 px-3 py-1 text-xs text-ink hover:bg-bg-card"
            >
              Save body
            </button>
            <button
              type="button"
              onClick={onPreview}
              disabled={previewLoading}
              className="rounded border border-accent/40 bg-accent/10 px-3 py-1 text-xs text-accent hover:bg-accent/20 disabled:opacity-50"
            >
              {previewLoading ? 'Previewing…' : 'Preview'}
            </button>
            <span className="text-[11px] text-ink-dim italic">
              Preview is read-only — does not post in Discord.
            </span>
          </div>
        </ServerForm>

        {/* Preview output */}
        {(preview || previewError) && (
          <div className="rounded-lg border border-line bg-bg-card2/60 p-3 flex flex-col gap-2">
            <div className="flex items-center gap-2 text-xs">
              <span className="uppercase tracking-wider text-ink-dim">Preview</span>
              {preview?.ok && (
                <span className="inline-flex items-center rounded-full border border-ok/30 bg-ok/15 px-2 py-0.5 font-medium uppercase tracking-wider text-ok">
                  rendered
                </span>
              )}
              {preview?.ok === false && (
                <span className="inline-flex items-center rounded-full border border-err/30 bg-err/15 px-2 py-0.5 font-medium uppercase tracking-wider text-err">
                  {preview.error}
                </span>
              )}
              {previewError && (
                <span className="inline-flex items-center rounded-full border border-err/30 bg-err/15 px-2 py-0.5 font-medium uppercase tracking-wider text-err">
                  {previewError}
                </span>
              )}
              {preview?.ok && preview.data.usingDefault && (
                <span className="text-ink-dim">
                  (using built-in default — no override saved)
                </span>
              )}
            </div>
            {preview?.ok && (
              <pre className="whitespace-pre-wrap break-words rounded border border-line bg-bg-card p-2 text-xs font-mono text-ink">
                {preview.data.rendered}
              </pre>
            )}
            {preview?.ok === false && preview.error === 'timeout' && (
              <p className="text-[11px] text-ink-dim">
                Bot didn't reply within the RPC timeout. Verify the
                SquishyBot subscriber is running and{' '}
                <code className="font-mono">BOTPANEL_RPC_SECRET</code>{' '}
                matches on both sides.
              </p>
            )}
            {preview?.ok === false && preview.error === 'rpc-not-configured' && (
              <p className="text-[11px] text-ink-dim">
                <code className="font-mono">BOTPANEL_RPC_SECRET</code> is
                unset in the panel env — preview requires the command bus.
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

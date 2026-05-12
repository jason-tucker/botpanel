'use client'
/**
 * <ServerForm> — the canonical write-side form for the dashboard.
 *
 * Usage:
 *   <ServerForm action="/api/squishy/settings/foo.bar" method="PUT">
 *     <input name="value" defaultValue={current} />
 *     <button type="submit">Save</button>
 *   </ServerForm>
 *
 * What it gives you for free:
 *  - CSRF: lazily fetches `/api/csrf` once per mount, caches the
 *    token in a module-level singleton, and adds it as the
 *    `x-csrf-token` header on every submit.
 *  - JSON or form-encoded body: drops a hidden
 *    `<input name="_format" value="json">` to opt into JSON; default
 *    is `application/x-www-form-urlencoded`.
 *  - Disabled-while-submitting: every nested submit button and input
 *    gets `disabled` for the duration of the request via the
 *    `fieldset[disabled]` trick so users can't double-fire.
 *  - 4xx error banner: surfaces the JSON `error` (or first message
 *    in `errors[]`) in a red banner above the form so callers
 *    don't have to wire toast plumbing for every form.
 *  - 2xx hook: optional `onSuccess(data)` callback for refetches /
 *    redirects / toast plumbing in the caller.
 *
 * Deliberately does NOT auto-redirect or auto-refresh — the caller
 * controls navigation. We just hand back the parsed JSON.
 */
import {
  useCallback,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'

export type ServerFormProps = {
  action: string
  method?: 'POST' | 'PUT' | 'DELETE' | 'PATCH'
  onSuccess?: (data: unknown) => void
  /** Call form.reset() after a successful submit. Useful for "add new" forms. */
  resetOnSuccess?: boolean
  /**
   * If set, prompts the user with `window.confirm(confirm)` before submitting.
   * Cancel → submit is aborted, no state change. Used for destructive actions.
   */
  confirm?: string
  className?: string
  children: ReactNode
}

// Module-level cache so several <ServerForm>s share one token across
// the page. The server rotates tokens lazily anyway — we don't need
// a fresh one per submit, just a still-valid one per page lifetime.
let cachedToken: string | null = null
let inflight: Promise<string | null> | null = null

async function getCsrfToken(): Promise<string | null> {
  if (cachedToken) return cachedToken
  if (inflight) return inflight
  inflight = (async () => {
    try {
      const res = await fetch('/api/csrf', {
        method: 'GET',
        credentials: 'same-origin',
      })
      if (!res.ok) return null
      const body = (await res.json()) as { token?: unknown }
      if (typeof body.token === 'string') {
        cachedToken = body.token
        return cachedToken
      }
      return null
    } catch {
      return null
    } finally {
      inflight = null
    }
  })()
  return inflight
}

/** Drop the cache when a 403 csrf error comes back — the next
 *  submit will refetch. Avoids one-bad-token stalemates. */
function bustCsrfCache(): void {
  cachedToken = null
}

function readErrorMessage(parsed: unknown, fallback: string): string {
  if (parsed && typeof parsed === 'object') {
    const o = parsed as Record<string, unknown>
    if (typeof o.error === 'string') return o.error
    if (typeof o.message === 'string') return o.message
    if (Array.isArray(o.errors) && o.errors.length > 0) {
      const first = o.errors[0]
      if (typeof first === 'string') return first
      if (first && typeof first === 'object' && typeof (first as { message?: unknown }).message === 'string') {
        return (first as { message: string }).message
      }
    }
  }
  return fallback
}

export function ServerForm(props: ServerFormProps): React.JSX.Element {
  const { action, method = 'POST', onSuccess, resetOnSuccess, confirm: confirmMsg, className, children } = props
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const formRef = useRef<HTMLFormElement | null>(null)

  const onSubmit = useCallback(
    async (ev: FormEvent<HTMLFormElement>) => {
      ev.preventDefault()
      if (submitting) return
      if (confirmMsg && typeof window !== 'undefined' && !window.confirm(confirmMsg)) return
      setError(null)
      setSubmitting(true)

      const form = ev.currentTarget
      const data = new FormData(form)
      // Was a `_format=json` hint dropped into the form? If so, we
      // ship JSON; otherwise stay with form-encoded.
      const asJson = data.get('_format') === 'json'

      let token = await getCsrfToken()

      const doFetch = async (csrfToken: string | null): Promise<Response> => {
        const headers: Record<string, string> = {}
        if (csrfToken) headers['x-csrf-token'] = csrfToken

        let body: BodyInit
        if (asJson) {
          headers['content-type'] = 'application/json'
          const obj: Record<string, unknown> = {}
          for (const [k, v] of data.entries()) {
            // Skip the format hint + the CSRF echo (which we send as
            // a header, not a body field).
            if (k === '_format' || k === '_csrf') continue
            obj[k] = typeof v === 'string' ? v : v.name
          }
          body = JSON.stringify(obj)
        } else {
          // URL-encoded — drop the format hint but keep _csrf so
          // non-JS form posts still pass verification. FormData
          // entries that are Files don't have a meaningful URL-encoded
          // representation; we coerce to their filename so the
          // request still sends something rather than `[object File]`.
          data.delete('_format')
          if (csrfToken && !data.has('_csrf')) data.set('_csrf', csrfToken)
          const params = new URLSearchParams()
          for (const [k, v] of data.entries()) {
            params.append(k, typeof v === 'string' ? v : v.name)
          }
          body = params.toString()
          headers['content-type'] = 'application/x-www-form-urlencoded'
        }

        return fetch(action, {
          method,
          headers,
          body,
          credentials: 'same-origin',
        })
      }

      try {
        let res = await doFetch(token)
        // 403 + {error:'csrf'} means our cached token is stale or
        // the cookie was rotated. Refetch once and retry.
        if (res.status === 403) {
          let isCsrf = false
          try {
            const peek = await res.clone().json()
            if (peek && typeof peek === 'object' && (peek as { error?: string }).error === 'csrf') {
              isCsrf = true
            }
          } catch {
            // not JSON — leave isCsrf false
          }
          if (isCsrf) {
            bustCsrfCache()
            token = await getCsrfToken()
            res = await doFetch(token)
          }
        }

        let parsed: unknown = null
        try {
          parsed = await res.json()
        } catch {
          parsed = null
        }

        if (res.ok) {
          if (resetOnSuccess) form.reset()
          if (onSuccess) onSuccess(parsed)
        } else {
          setError(readErrorMessage(parsed, `Request failed (${res.status})`))
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Network error')
      } finally {
        setSubmitting(false)
      }
    },
    [action, method, onSuccess, resetOnSuccess, confirmMsg, submitting],
  )

  return (
    <form
      ref={formRef}
      action={action}
      method="post"
      onSubmit={onSubmit}
      className={className}
      noValidate
    >
      {error && (
        <div
          role="alert"
          className="mb-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200"
        >
          {error}
        </div>
      )}
      {/*
       * fieldset[disabled] cascades the disabled state to every
       * nested form control without each caller having to thread
       * a `submitting` prop into its inputs/buttons.
       */}
      <fieldset disabled={submitting} className="contents">
        {children}
      </fieldset>
    </form>
  )
}

export default ServerForm

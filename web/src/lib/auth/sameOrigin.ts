/**
 * Same-origin check for plain HTML form POSTs that cannot carry a CSRF
 * token (logout: the forms are server-rendered and work without JS).
 *
 * Pure (zero runtime imports) for `node --experimental-strip-types` checks.
 *
 *  - `Origin` present: must equal the expected origin exactly ("null" and
 *    unparsable values are rejected).
 *  - `Origin` absent: accept only `Sec-Fetch-Site: same-origin`.
 *  - Neither header: reject.
 */

type HeaderReader = { get(name: string): string | null }

function originOf(raw: string): string | null {
  try {
    const o = new URL(raw).origin
    return o === 'null' ? null : o
  } catch {
    return null
  }
}

/**
 * The public origin the browser should send. Behind Caddy `req.url` is the
 * internal address, so `PUBLIC_BASE_URL` wins; the request URL is only the
 * local-dev fallback when it is unset.
 */
export function expectedOriginFrom(publicBaseUrl: string | undefined, requestUrl: string): string {
  return (publicBaseUrl ? originOf(publicBaseUrl) : null) ?? new URL(requestUrl).origin
}

export function isSameOriginRequest(headers: HeaderReader, expectedOrigin: string): boolean {
  const expected = originOf(expectedOrigin)
  if (!expected) return false
  const origin = headers.get('origin')
  if (origin !== null) {
    if (origin === 'null') return false
    return originOf(origin) === expected
  }
  return headers.get('sec-fetch-site') === 'same-origin'
}

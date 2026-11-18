/**
 * Log-safe rendering of a Redis connection URL (pure, no imports).
 *
 * Keeps scheme, host, port and db; masks the userinfo (user and password) and drops the
 * query string entirely (ioredis reads options such as `?password=` from it).
 * Anything that does not parse is replaced by a fixed placeholder, so the
 * raw string is never echoed.
 */
export function redactRedisUrl(raw: string): string {
  // Unix socket path, as ioredis accepts it: keep the path, drop the query.
  if (raw.startsWith('/') && !raw.startsWith('//')) {
    const q = raw.indexOf('?')
    return q === -1 ? raw : `${raw.slice(0, q)}?[redacted]`
  }
  let u: URL
  try {
    // ioredis also accepts "host:port" and "//host"; normalise like it does.
    const withScheme = /^rediss?:\/\//i.test(raw)
      ? raw
      : raw.startsWith('//')
        ? `redis:${raw}`
        : `redis://${raw}`
    u = new URL(withScheme)
  } catch {
    return '[unparseable redis url]'
  }
  // Mask the whole userinfo: `redis://secret@host` puts a secret in the
  // username slot, so the username is not safe to print either.
  const auth = u.username || u.password ? '***@' : ''
  const port = u.port ? `:${u.port}` : ''
  const path = u.pathname && u.pathname !== '/' ? u.pathname : ''
  const query = u.search ? '?[redacted]' : ''
  return `${u.protocol}//${auth}${u.hostname}${port}${path}${query}`
}

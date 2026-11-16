/**
 * In-process cache in front of the `panel_sessions` revocation lookup.
 *
 * Pure (zero runtime imports) so scratch checks can run it with
 * `node --experimental-strip-types`; keep it free of enums, namespaces and
 * parameter properties.
 *
 * Contract (fail closed with a short stale grace):
 *  - A verdict (valid or revoked) is reused for `ttlMs` (30 s), so a deleted
 *    row ends its session within that window; `forget` / `clearExcept`
 *    make it immediate in this process (logout, logout-all).
 *  - One lookup in flight per (jti, user).
 *  - Lookup error or no answer within `timeoutMs` (750 ms): a cached
 *    *valid* verdict for the same user checked within `staleGraceMs`
 *    (5 min) still counts as valid; otherwise 'unavailable'. A cached
 *    revoked verdict never turns valid on error.
 *  - After a failed or timed-out lookup, lookups are skipped for
 *    `unavailableMs` (2 s) and every check answers from the fallback above,
 *    so an outage doesn't queue a lookup per request.
 *  - `prepare` (optional, e.g. a lazy CREATE TABLE) runs before the lookup,
 *    once at a time, inside the same `timeoutMs` budget, so a check never
 *    waits longer than `timeoutMs` in total. Its errors are ignored and the
 *    lookup runs anyway. If the budget runs out while it is still pending,
 *    that counts as a timed-out lookup (back-off above), and later checks
 *    stop waiting for it and run the lookup directly until it settles.
 *  - A query that outlives its budget leaves a per-(jti, user) "stuck"
 *    marker until it settles. While it is set, checks for that jti answer
 *    from the fallback and start no second query, and once `maxConcurrent`
 *    (2) stuck markers exist, checks that would start a new query answer
 *    from the fallback too, so a hung DB cannot drain the connection pool.
 *    Lookups still inside their budget never count: a healthy lookup never
 *    blocks or fails another user's check. A marker older than
 *    `maxHoldMs` (30 s) is dropped so a query that never settles cannot
 *    wedge the validator for good. A late answer is never cached.
 *  - `seed` records a fresh valid verdict (a row this process just wrote).
 *  - At `maxEntries` expired entries are swept first, then the oldest go.
 */

export type SessionVerdict = 'valid' | 'revoked' | 'unavailable'
export type SessionLookup = (jti: string, userId: string) => Promise<boolean>

export type SessionValidatorOptions = {
  lookup: SessionLookup
  now?: () => number
  ttlMs?: number
  staleGraceMs?: number
  timeoutMs?: number
  maxEntries?: number
  unavailableMs?: number
  maxConcurrent?: number
  maxHoldMs?: number
  prepare?: () => Promise<void>
}

export type SessionValidator = {
  check(jti: string, userId: string): Promise<SessionVerdict>
  /** Record a valid verdict for a row this process just inserted. */
  seed(jti: string, userId: string): void
  forget(jti: string): void
  clearExcept(jti: string | null): void
  /** Cached entries (for checks and diagnostics). */
  size(): number
}

type Entry = { valid: boolean; userId: string; checkedAt: number }
type InFlight = { jti: string; promise: Promise<SessionVerdict> }
type PrepareRun = { promise: Promise<void>; stalled: boolean }
// One per stuck query; compared by identity, never by value.
type StuckMarker = { since: number }

export function createSessionValidator(opts: SessionValidatorOptions): SessionValidator {
  const lookup = opts.lookup
  const now = opts.now ?? Date.now
  const ttlMs = opts.ttlMs ?? 30_000
  const staleGraceMs = opts.staleGraceMs ?? 300_000
  const timeoutMs = opts.timeoutMs ?? 750
  const maxEntries = opts.maxEntries ?? 2000
  const unavailableMs = opts.unavailableMs ?? 2_000
  const maxConcurrent = opts.maxConcurrent ?? 2
  const maxHoldMs = opts.maxHoldMs ?? 30_000
  const prepare = opts.prepare

  const cache = new Map<string, Entry>()
  const inflight = new Map<string, InFlight>()
  // Queries that outlived their budget and have not settled yet.
  const stuck = new Map<string, StuckMarker>()
  // Until this time, skip lookups (the store just failed to answer).
  let unavailableUntil = 0
  // The prepare attempt still running, if any (shared by every check).
  let preparing: PrepareRun | null = null

  function isExpired(e: Entry, t: number): boolean {
    // A valid entry still backs the stale grace; a revoked one is useless
    // once its TTL is over.
    return t - e.checkedAt >= (e.valid ? staleGraceMs : ttlMs)
  }

  function store(jti: string, e: Entry): void {
    cache.delete(jti) // re-insert so Map order is oldest-first
    if (cache.size >= maxEntries) {
      const t = now()
      for (const [k, v] of cache) if (isExpired(v, t)) cache.delete(k)
      while (cache.size >= maxEntries) {
        const oldest = cache.keys().next()
        if (oldest.done) break
        cache.delete(oldest.value)
      }
    }
    cache.set(jti, e)
  }

  function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('session lookup timed out')), ms)
    })
    return Promise.race([p, timeout]).finally(() => clearTimeout(timer))
  }

  function startPrepare(): PrepareRun | null {
    if (!prepare) return null
    if (preparing) return preparing
    const run: PrepareRun = { promise: Promise.resolve(), stalled: false }
    run.promise = Promise.resolve()
      .then(prepare)
      .catch(() => {
        // Ignored: the lookup still gets its chance.
      })
      .finally(() => {
        if (preparing === run) preparing = null
      })
    preparing = run
    return run
  }

  function stuckCount(): number {
    const t = now()
    for (const [k, m] of stuck) if (t - m.since >= maxHoldMs) stuck.delete(k)
    return stuck.size
  }

  function fallback(jti: string, userId: string): SessionVerdict {
    const e = cache.get(jti)
    if (e && e.valid && e.userId === userId && now() - e.checkedAt <= staleGraceMs) return 'valid'
    return 'unavailable'
  }

  function check(jti: string, userId: string): Promise<SessionVerdict> {
    const hit = cache.get(jti)
    if (hit && hit.userId === userId && now() - hit.checkedAt < ttlMs) {
      return Promise.resolve(hit.valid ? 'valid' : 'revoked')
    }
    const key = `${jti}\u0000${userId}`
    const running = inflight.get(key)
    if (running) return running.promise
    if (now() < unavailableUntil) return Promise.resolve(fallback(jti, userId))
    // A query for this jti is stuck, or enough queries are stuck that the
    // pool is at risk: answer from the fallback without starting another.
    if (stuckCount() >= maxConcurrent || stuck.has(key)) {
      return Promise.resolve(fallback(jti, userId))
    }

    const self: InFlight = { jti, promise: Promise.resolve('unavailable') }
    self.promise = (async (): Promise<SessionVerdict> => {
      const run = startPrepare()
      let abandoned = false
      let lookupStarted = false
      let lookupSettled = false
      let marker: StuckMarker | null = null
      const work = (async (): Promise<boolean> => {
        // A prepare that already overran a budget is not waited on again.
        if (run && !run.stalled) await run.promise
        if (abandoned) return false // budget spent; skip the stray query
        lookupStarted = true
        return Promise.resolve()
          .then(() => lookup(jti, userId))
          .finally(() => {
            lookupSettled = true
            if (marker && stuck.get(key) === marker) stuck.delete(key)
          })
      })()
      work.catch(() => {
        // Handled by the race below; this only stops an unhandled rejection
        // when the budget already ran out.
      })
      try {
        const ok = await withTimeout(work, timeoutMs)
        // Only record the answer if nobody called forget/clearExcept while
        // the lookup was running (it may predate the row's deletion).
        if (inflight.get(key) === self) {
          store(jti, { valid: ok, userId, checkedAt: now() })
        }
        return ok ? 'valid' : 'revoked'
      } catch {
        abandoned = true
        // The query is running past its budget: mark it stuck until it
        // settles. A budget spent before the query started marks nothing.
        if (lookupStarted && !lookupSettled) {
          marker = { since: now() }
          stuck.set(key, marker)
        }
        if (run && preparing === run) run.stalled = true
        unavailableUntil = now() + unavailableMs
        return fallback(jti, userId)
      } finally {
        if (inflight.get(key) === self) inflight.delete(key)
      }
    })()
    inflight.set(key, self)
    return self.promise
  }

  function seed(jti: string, userId: string): void {
    store(jti, { valid: true, userId, checkedAt: now() })
  }

  function forget(jti: string): void {
    cache.delete(jti)
    for (const [k, v] of inflight) if (v.jti === jti) inflight.delete(k)
  }

  function clearExcept(keep: string | null): void {
    for (const k of [...cache.keys()]) if (k !== keep) cache.delete(k)
    for (const [k, v] of inflight) if (v.jti !== keep) inflight.delete(k)
  }

  return { check, seed, forget, clearExcept, size: () => cache.size }
}

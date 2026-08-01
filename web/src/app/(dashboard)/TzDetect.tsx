'use client'
/**
 * TzDetect — makes stats default to the viewer's local timezone.
 *
 * Mounted once in the app shell. On first visit it stores the browser's
 * IANA zone (`Intl.DateTimeFormat().resolvedOptions().timeZone`) in the
 * `stats_tz` cookie, which `normalizeTz` on the server uses as the default
 * whenever no explicit `?tz=` is in the URL. If the cookie was missing and
 * we're already ON a stats page (cold first landing), refresh once so the
 * current render picks the local zone up immediately.
 */
import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'

const COOKIE = 'stats_tz'

export function TzDetect() {
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    try {
      const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
      if (!zone) return
      const existing = document.cookie
        .split('; ')
        .find((c) => c.startsWith(`${COOKIE}=`))
        ?.slice(COOKIE.length + 1)
      if (existing === encodeURIComponent(zone)) return
      const hadCookie = existing !== undefined
      document.cookie = `${COOKIE}=${encodeURIComponent(zone)}; path=/; max-age=31536000; samesite=lax`
      // Cold landing on a stats page with no cookie yet: re-render so the
      // default flips from UTC to local right away instead of next visit.
      if (!hadCookie && pathname.includes('/stats')) router.refresh()
    } catch {
      // Intl unavailable — stats stay on UTC.
    }
    // Run once per shell mount; the zone can't change without a reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return null
}

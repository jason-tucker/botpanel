import Link from 'next/link'
import { getSession } from '@/lib/auth/session'

/**
 * Public home / sign-in card.
 *
 * Stays at the root layout (NOT inside the `(dashboard)` route group) so
 * unauthenticated visitors don't trip the dashboard layout's session
 * redirect. For signed-in viewers we just show an "Open dashboard" CTA —
 * the actual nav now lives in the sidebar inside the dashboard shell, so
 * there's no need to mirror every link here.
 */
const ERROR_MESSAGES: Record<string, string> = {
  missing_params: 'Discord didn’t return an auth code. Try again, and make sure to click Authorize on the consent screen.',
  bad_state: 'OAuth state mismatch — the sign-in took too long or was tampered with. Try again.',
  callback_failed: 'Discord rejected the auth code. The Client Secret may be stale or the redirect URI mismatched. Check server logs.',
}

export default async function Home({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const session = await getSession()
  const params = await searchParams
  const errorMsg = params.error ? (ERROR_MESSAGES[params.error] ?? `Sign-in error: ${params.error}`) : null
  return (
    <main className="min-h-dvh flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-line bg-bg-card p-6 flex flex-col gap-5">
        <h1 className="text-2xl font-semibold">Botpanel</h1>
        <p className="text-ink-dim">Discord admin dashboard for SquishyBot & OtterBot.</p>

        {errorMsg && (
          <div className="rounded-lg border border-red-900 bg-red-950/40 text-red-200 text-sm p-3">
            {errorMsg}
          </div>
        )}

        {session ? (
          <div className="flex flex-col gap-3">
            <div className="rounded-lg bg-bg-card2 border border-line p-3">
              <div className="text-sm text-ink-dim">Signed in as</div>
              <div className="font-medium">{session.username}</div>
            </div>
            <Link
              href="/me"
              className="inline-flex items-center justify-center rounded-lg bg-accent text-white font-semibold px-4 py-2.5"
            >
              Open dashboard
            </Link>
            <form action="/api/auth/logout" method="POST">
              <button type="submit" className="w-full rounded-lg border border-line bg-transparent text-ink-dim px-4 py-2.5">
                Sign out
              </button>
            </form>
          </div>
        ) : (
          <a
            href="/api/auth/login"
            className="inline-flex items-center justify-center rounded-lg bg-accent text-white font-semibold px-4 py-2.5"
          >
            Sign in with Discord
          </a>
        )}

        <div className="text-xs text-ink-dim text-center pt-2 border-t border-line">
          MVP foundation — read-only views coming soon.
        </div>
      </div>
    </main>
  )
}

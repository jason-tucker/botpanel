/**
 * /squishy/welcome — welcome / goodbye template editor (sudo-only).
 *
 * Server component:
 *  - Auths + gates on `access.squishy.sudo || access.botOwner`. Non-sudo
 *    viewers get a 403 card (same shape as `/squishy/settings`).
 *  - Reads the four relevant `bot_settings` rows directly via Drizzle
 *    (`welcome.enabled`, `welcome.channel_id`, `welcome.template`,
 *    `goodbye.enabled`, `goodbye.channel_id`, `goodbye.template`). The
 *    existing API at `/api/squishy/settings` is for client tooling — same
 *    Node process so the direct read is fine and avoids an internal hop.
 *  - DB-down → render empty defaults + a banner. We never 500.
 *  - Renders `<WelcomeEditor>` (client) twice, once per kind, in a two-
 *    column layout that collapses on mobile.
 *
 * Why a dedicated page when `/squishy/settings` already edits arbitrary
 * `bot_settings` keys? Discoverability + safety: a sudo operator can
 * configure welcome/goodbye end-to-end (enable, channel, body) without
 * scrolling through 80 unrelated rows, and the inline **Preview** button
 * dry-runs the render via the new `welcome.preview` RPC verb without
 * posting in Discord. The actual save path is the **same** PUT endpoint
 * the settings table uses — no duplicate write surface.
 *
 * Wave 7d will replace the raw channel-ID text input with a `<ChannelPicker>`
 * dropdown (needs a bot-side `channels.list` verb). Until then the input
 * accepts a snowflake; the bot validates at post time.
 */
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { inArray } from 'drizzle-orm'
import { getSession } from '@/lib/auth/session'
import { resolveAccess } from '@/lib/auth/perms'
import { squishyDb, squishySchema } from '@/lib/db/squishy'
import { WelcomeEditor } from './WelcomeEditor'

export const dynamic = 'force-dynamic'

const KEYS = [
  'welcome.enabled',
  'welcome.channel_id',
  'welcome.template',
  'goodbye.enabled',
  'goodbye.channel_id',
  'goodbye.template',
] as const

type SettingMap = Record<(typeof KEYS)[number], string | null>

async function loadWelcomeSettings(): Promise<{
  values: SettingMap
  error: 'db-unavailable' | null
}> {
  const empty: SettingMap = {
    'welcome.enabled': null,
    'welcome.channel_id': null,
    'welcome.template': null,
    'goodbye.enabled': null,
    'goodbye.channel_id': null,
    'goodbye.template': null,
  }
  try {
    const rows = await squishyDb
      .select()
      .from(squishySchema.botSettings)
      .where(inArray(squishySchema.botSettings.key, [...KEYS]))
    const out: SettingMap = { ...empty }
    for (const r of rows) {
      if ((KEYS as readonly string[]).includes(r.key)) {
        out[r.key as keyof SettingMap] = r.value
      }
    }
    return { values: out, error: null }
  } catch (err) {
    console.warn('[squishy/welcome page] DB unreachable; rendering empty', err)
    return { values: empty, error: 'db-unavailable' }
  }
}

export default async function SquishyWelcomePage() {
  const session = await getSession()
  if (!session) redirect('/api/auth/login')

  const access = await resolveAccess(session)
  const allowed = access.squishy.sudo || access.botOwner

  if (!allowed) {
    return (
      <main className="min-h-dvh p-6 sm:p-10">
        <div className="max-w-md mx-auto rounded-2xl border border-line bg-bg-card p-6 flex flex-col gap-3">
          <h1 className="text-xl font-semibold">Not authorized</h1>
          <p className="text-ink-dim text-sm">
            The welcome / goodbye editor is restricted to Squishy sudo users
            and the bot owner.
          </p>
          <Link href="/me" className="text-sm text-accent underline self-start">
            ← Back to dashboard
          </Link>
        </div>
      </main>
    )
  }

  const { values, error } = await loadWelcomeSettings()

  return (
    <main className="min-h-dvh p-6 sm:p-10">
      <div className="max-w-6xl mx-auto flex flex-col gap-6">
        <header className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold">Welcome &amp; Goodbye</h1>
            <p className="text-sm text-ink-dim max-w-2xl">
              Configure the messages SquishyBot posts when a member joins or
              leaves the server. Bot reads these settings live on every
              join / leave event — no cache to flush, no redeploy needed.
            </p>
          </div>
          <Link href="/squishy/settings" className="text-sm text-ink-dim hover:text-ink whitespace-nowrap">
            All settings →
          </Link>
        </header>

        {error === 'db-unavailable' && (
          <div className="rounded-xl border border-line bg-bg-card p-3 text-xs text-warn">
            Squishy DB is unreachable — showing empty defaults. Existing
            settings will reappear once Postgres is back. Saves will fail
            with a friendly error until then.
          </div>
        )}

        <div className="rounded-xl border border-line bg-bg-card2/40 p-3 text-xs text-ink-dim">
          <p className="mb-1 font-medium uppercase tracking-wider text-ink">
            Tokens
          </p>
          <p>
            <code className="font-mono">{'{user}'}</code> — mention of the
            joining / leaving member ·{' '}
            <code className="font-mono">{'{server}'}</code> — guild name ·{' '}
            <code className="font-mono">{'{member_count}'}</code> — current
            member count ·{' '}
            <code className="font-mono">{'{account_age}'}</code> — relative
            time since the user's Discord account was created
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <WelcomeEditor
            kind="welcome"
            enabled={values['welcome.enabled'] === 'true'}
            channelId={values['welcome.channel_id'] ?? ''}
            template={values['welcome.template'] ?? ''}
          />
          <WelcomeEditor
            kind="goodbye"
            enabled={values['goodbye.enabled'] === 'true'}
            channelId={values['goodbye.channel_id'] ?? ''}
            template={values['goodbye.template'] ?? ''}
          />
        </div>
      </div>
    </main>
  )
}

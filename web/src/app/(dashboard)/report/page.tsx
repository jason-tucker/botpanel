/**
 * /report — file a bug / feature request / question.
 *
 * Open to any logged-in user. Renders TWO forms (one per bot) because each
 * bot's `/report` slash modal is independent — the owner gets a separate DM
 * per submission, and the GitHub issue lands in the corresponding bot's
 * repo (`GITHUB_REPO` env). The fields are identical for both bots (Title /
 * Type / Description / Steps) and validation rules match the bot's slash
 * modal: Title 5–200 chars, Description 10–2000 chars, Steps optional max
 * 1000 chars.
 *
 * The Type field on both bots is a free-text input on the slash side that the
 * server normalizes via `startsWith` to one of `bug`/`feature`/`question`.
 * We render a select with those three values so panel submissions are always
 * normalized — but the server-side route still accepts whatever the user
 * typed (the bot does the prefix match itself).
 */
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/session'
import { resolveAccess } from '@/lib/auth/perms'
import { env } from '@/lib/env'
import { ReportForm } from './ReportForm'

export const dynamic = 'force-dynamic'

export default async function ReportPage() {
  const session = await getSession()
  if (!session) redirect('/api/auth/login')

  const access = await resolveAccess(session)

  // Each form is per-bot-gated on guild membership so users only see
  // forms for the bots they actually use. Mirrors the Sidebar gates so
  // the experience stays consistent. Legacy JWTs (no guildIds field)
  // fall back to "show both" — same posture as the sidebar.
  const guildIdsKnown = Array.isArray(session.guildIds)
  const squishyGuildId = env.GUILD_ID ?? null
  const inSquishyGuild =
    guildIdsKnown && squishyGuildId !== null
      ? (session.guildIds ?? []).includes(squishyGuildId)
      : null
  const inOtterGuild = Object.keys(access.otter.businesses).length > 0

  const showSquishyForm = inSquishyGuild === null ? true : inSquishyGuild || access.botOwner
  const showOtterForm = inOtterGuild || access.botOwner

  return (
    <main className="min-h-dvh p-6 sm:p-10 pt-16 md:pt-10">
      <div className="max-w-3xl mx-auto flex flex-col gap-6">
        <header className="flex items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold">Report a bug</h1>
            <p className="text-sm text-ink-dim">
              File a bug, feature request, or question against one of the bots.
              The owner reviews every report via DM before it lands on GitHub —
              same flow as <code className="font-mono text-xs">/report</code>{' '}
              in the server.
            </p>
          </div>
          <Link href="/me" className="text-sm text-ink-dim hover:text-ink whitespace-nowrap">
            ← Dashboard
          </Link>
        </header>

        {showSquishyForm && <ReportForm bot="squishy" />}
        {showOtterForm && <ReportForm bot="otter" />}
        {!showSquishyForm && !showOtterForm && (
          <div className="rounded-xl border border-line bg-bg-card p-6 text-sm text-ink-dim">
            You don&apos;t appear to be in either bot&apos;s Discord server, so
            there&apos;s no report form available right now. Join one of the
            servers and refresh — the relevant form will appear automatically.
          </div>
        )}
      </div>
    </main>
  )
}

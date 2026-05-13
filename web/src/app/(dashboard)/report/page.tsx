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
import { ReportForm } from './ReportForm'

export const dynamic = 'force-dynamic'

export default async function ReportPage() {
  const session = await getSession()
  if (!session) redirect('/api/auth/login')

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

        <ReportForm bot="squishy" />
        <ReportForm bot="otter" />
      </div>
    </main>
  )
}

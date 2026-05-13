/**
 * /otter/tc-sheet — Trading Card sheet link.
 *
 * Mirrors otterbot's `/tcsheet` slash command. Single CTA (open the
 * Google Sheets template) + naming guidance. Same copy as
 * `otterbot/src/commands/tcSheet.ts`.
 */
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'

const SHEET_URL =
  'https://docs.google.com/spreadsheets/d/1JBT6-cuMNv9LP7YXvSboU56ry2-Jg7CCMVV-L2ShBPw/copy'

const BRAND_BORDER = 'border-l-[3px] border-[#588c7e]'

export default async function TcSheetPage() {
  const session = await getSession()
  if (!session) redirect('/api/auth/login')

  return (
    <main className="min-h-dvh p-6 sm:p-10 pt-16 md:pt-10">
      <div className="max-w-2xl mx-auto flex flex-col gap-6">
        <header>
          <h1 className="text-2xl font-semibold">
            📊 <code className="font-mono">/tcsheet</code> — Trading Card Sheet
          </h1>
          <p className="text-sm text-ink-dim mt-1">
            Get the Trading Card order sheet. Same content the bot renders
            for <code>/tcsheet</code>.
          </p>
        </header>

        <section className={`rounded-2xl border border-line bg-bg-card p-5 pl-6 ${BRAND_BORDER}`}>
          <h2 className="text-lg font-semibold mb-2">Open Sheet</h2>
          <p className="text-sm leading-relaxed mb-4">
            Click the button to copy the sheet. Be sure to set sharing to{' '}
            <strong>Anyone can edit</strong>.
          </p>
          <a
            href={SHEET_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-lg bg-accent text-bg px-4 py-2 text-sm font-medium hover:bg-accent/90"
          >
            <span>📊</span>
            <span>Open Sheet</span>
          </a>
        </section>

        <section className={`rounded-2xl border border-line bg-bg-card p-5 pl-6 ${BRAND_BORDER}`}>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-dim mb-2">
            Rename your copy to
          </h2>
          <p className="text-sm">
            <strong>Ticket Number _ Pack Title</strong>
          </p>
          <p className="font-mono text-sm text-ink-dim mt-1">101_McKenzieFamilyTCs</p>
        </section>
      </div>
    </main>
  )
}

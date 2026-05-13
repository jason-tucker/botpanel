/**
 * /otter/print-info — McKenzie Enterprises printing reference.
 *
 * Mirrors the otterbot `/printinfo` slash command + its three sub-buttons
 * (Business Cards / Trading Cards / Other Printables). Static content,
 * no RPC, no API routes — the bot's source is the spec, we just render
 * the same copy on the panel so users who'd otherwise type `/printinfo`
 * have a stable URL to share.
 *
 * Content is mirrored verbatim from `otterbot/src/commands/printInfo.ts`
 * and `interactions/buttons/printInfoButton.ts`. If the bot copy changes,
 * update this page in the same PR.
 *
 * Gate: signed-in only (the slash command itself is `setDMPermission(false)`
 * but is open to everyone in the guild — same posture here).
 */
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'

const BRAND_BORDER = 'border-l-[3px] border-[#588c7e]'

export default async function PrintInfoPage() {
  const session = await getSession()
  if (!session) redirect('/api/auth/login')

  return (
    <main className="min-h-dvh p-6 sm:p-10 pt-16 md:pt-10">
      <div className="max-w-3xl mx-auto flex flex-col gap-6">
        <header>
          <h1 className="text-2xl font-semibold">
            <code className="font-mono">/printinfo</code> — McKenzie Printing
          </h1>
          <p className="text-sm text-ink-dim mt-1">
            McKenzie Enterprises printing information and pricing. Same copy
            the bot renders for <code>/printinfo</code>.
          </p>
        </header>

        <section className={`rounded-2xl border border-line bg-bg-card p-5 pl-6 ${BRAND_BORDER}`}>
          <h2 className="text-lg font-semibold mb-2">Printing Overview</h2>
          <p className="text-sm leading-relaxed">
            All printables at McKenzie Enterprises need to be uploaded to your own{' '}
            <a href="https://postimages.org/" target="_blank" rel="noreferrer" className="text-accent underline">
              PostImages
            </a>{' '}
            account. This helps ensure prints do not get deleted by our staff,
            or by PostImages if posted anonymously.
          </p>
          <p className="text-sm leading-relaxed mt-3">
            To help keep printing costs down, we offer bulk printing discounts:
          </p>
          <ul className="mt-2 text-sm font-mono text-ink-dim/90 flex flex-col gap-0.5 pl-1">
            <li>$200 for 1 Print</li>
            <li>$2,500 for 25 Prints</li>
            <li>$5,000 for 50 Prints</li>
            <li>$10,000 for 100 Prints</li>
          </ul>
          <p className="text-xs text-ink-dim mt-3">USB Sticks are no longer for sale.</p>
        </section>

        <section className={`rounded-2xl border border-line bg-bg-card p-5 pl-6 ${BRAND_BORDER}`}>
          <h2 className="text-lg font-semibold mb-2">🖼️ Business Cards</h2>
          <p className="text-sm leading-relaxed">
            Business Cards must be designed to fit onto a <code>1920x1080</code>{' '}
            canvas while having the actual business card be about{' '}
            <code>1280x720</code> centered in the middle. This allows the game
            to still be in the background as the image basically opens up
            fullscreen.
          </p>
          <p className="text-sm leading-relaxed mt-2">
            They can have transparency, holes, cuts, and rounded edges.
          </p>
          <p className="text-sm leading-relaxed mt-2">
            GIFs are also accepted, however quality-checked to ensure they are
            realistic in nature (should only be used for holographic designs
            or metallic finishes).
          </p>
        </section>

        <section className={`rounded-2xl border border-line bg-bg-card p-5 pl-6 ${BRAND_BORDER}`}>
          <h2 className="text-lg font-semibold mb-2">🃏 Trading Cards</h2>
          <p className="text-sm leading-relaxed">
            All Trading Cards are printed through McKenzie Enterprises. Prints
            are <strong>$300 per</strong>. No bulk printing offered.{' '}
            <a
              href="https://mke.euphoric.gg/info/trading-cards"
              target="_blank"
              rel="noreferrer"
              className="text-accent underline"
            >
              See more information here
            </a>
            .
          </p>
          <p className="text-xs text-ink-dim mt-2">
            Designs must be approved by an MKE Manager to ensure utmost quality.
          </p>
        </section>

        <section className={`rounded-2xl border border-line bg-bg-card p-5 pl-6 ${BRAND_BORDER}`}>
          <h2 className="text-lg font-semibold mb-2">📄 Other Printables</h2>
          <p className="text-sm leading-relaxed">
            All other printables must fit on a <code>1920x1080</code>{' '}
            transparent canvas with the poster/flyer placed in the middle.
          </p>
          <h3 className="text-sm font-semibold mt-3 mb-1">Books</h3>
          <p className="text-sm leading-relaxed">
            Books are <code>1285x904</code>. Please ask an{' '}
            <strong>MKE Manager</strong> for more info.
          </p>
          <ol className="mt-3 text-sm leading-relaxed list-decimal pl-5 flex flex-col gap-1">
            <li>
              All books/cards must be centered on a <code>1920x1080</code>{' '}
              canvas — without this the item takes up the entire screen.
            </li>
            <li>
              File format is <code>.png</code> uploaded to a hosting site such
              as PostImages (we prefer PostImages, but gyazo is also acceptable).
            </li>
            <li>
              Books have a <strong>maximum of 20 allotted pages</strong>: 18 +
              1 front cover and 1 back cover. This can become 38 + front and
              back cover as each page can be double-sided.
            </li>
            <li>
              All print requests must be submitted via a ticket. The template
              will be in the pinned message.
            </li>
          </ol>
        </section>
      </div>
    </main>
  )
}

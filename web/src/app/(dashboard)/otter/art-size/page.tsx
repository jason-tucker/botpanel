/**
 * /otter/art-size — Art and print size reference.
 *
 * Mirrors otterbot's `/artsize` slash command. Same copy the bot renders
 * (`otterbot/src/commands/artSize.ts`), reproduced here so users have a
 * stable URL to bookmark instead of scrolling Discord history. Static —
 * no RPC, no API routes.
 */
import Image from 'next/image'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'

const BRAND_BORDER = 'border-l-[3px] border-[#588c7e]'

type SizeRow = { emoji: string; label: string; sizes: string[]; note?: string }

const SIZES: SizeRow[] = [
  { emoji: '📸', label: 'Badge Photos', sizes: ['186x230'], note: 'Can be multiplied by 4' },
  { emoji: '🪧', label: 'Billboard', sizes: ['1500x600 horizontal', '600x1000 vertical'] },
  { emoji: '🖼️', label: 'Business Cards', sizes: ['1280x720 inside a 1920x1080 canvas'] },
  {
    emoji: '🏷️',
    label: 'Item',
    sizes: ['300x300'],
    note:
      '50px padding all around · Drop Shadow: Multiply · Opac 100% · Angle 125° · Distance 8 · Spread 10 · Size 21 · PSD available on request',
  },
  { emoji: '🔵', label: 'Logos', sizes: ['4000x4000'] },
  { emoji: '📱', label: 'Phone Backgrounds', sizes: ['1242x2688'] },
  { emoji: '🆔', label: 'Press Pass', sizes: ['600x900'] },
  { emoji: '📋', label: 'Office Banner', sizes: ['3600x1000'] },
  { emoji: '🏖️', label: 'Beach Stall Banner', sizes: ['511x114'] },
  { emoji: '🎯', label: 'Yeeter Size', sizes: ['1120x948'] },
  { emoji: '🃏', label: 'Trading Cards', sizes: ['750x1050'] },
]

export default async function ArtSizePage() {
  const session = await getSession()
  if (!session) redirect('/api/auth/login')

  return (
    <main className="min-h-dvh p-6 sm:p-10 pt-16 md:pt-10">
      <div className="max-w-3xl mx-auto flex flex-col gap-6">
        <header>
          <h1 className="text-2xl font-semibold">
            🎨 <code className="font-mono">/artsize</code> — Art Size Guide
          </h1>
          <p className="text-sm text-ink-dim mt-1">
            All dimensions in pixels. Same reference the bot renders for{' '}
            <code>/artsize</code>.
          </p>
        </header>

        <section className={`rounded-2xl border border-line bg-bg-card p-5 pl-6 ${BRAND_BORDER}`}>
          <ul className="flex flex-col gap-3 text-sm leading-relaxed">
            {SIZES.map((row) => (
              <li key={row.label}>
                <div>
                  <span className="mr-1.5">{row.emoji}</span>
                  <strong>{row.label}</strong> —{' '}
                  <span className="font-mono text-ink-dim/90">{row.sizes.join('  ·  ')}</span>
                </div>
                {row.note && (
                  <div className="text-xs text-ink-dim mt-1 pl-7">{row.note}</div>
                )}
              </li>
            ))}
          </ul>
        </section>

        <section className={`rounded-2xl border border-line bg-bg-card p-5 pl-6 ${BRAND_BORDER}`}>
          <p className="text-sm leading-relaxed">
            📠 All printable items use a <code>1920x1080</code> frame —
            transparent background required so the game shows through.
          </p>
          <p className="text-sm leading-relaxed mt-2 underline">
            All printable items (including Business Cards) now support
            transparency.
          </p>
        </section>

        <section className={`rounded-2xl border border-line bg-bg-card p-5 pl-6 ${BRAND_BORDER}`}>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-dim mb-3">
            Reference image
          </h2>
          <Image
            src="http://i.jasontucker.me/Print-Size-Guide.png"
            alt="Art size reference"
            width={1200}
            height={800}
            unoptimized
            className="rounded-lg border border-line max-w-full h-auto"
          />
        </section>
      </div>
    </main>
  )
}

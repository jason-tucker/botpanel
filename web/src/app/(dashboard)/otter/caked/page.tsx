/**
 * /otter/caked — Caked Up messaging page (manager+ of `caked-up`).
 *
 * Server component:
 *  - Auths + gates on `access.otter.businesses['caked-up'] === 'manager' ||
 *    === 'owner' || access.botOwner`. Non-manager viewers get a 403 card
 *    matching the shape of the other access-gated pages.
 *  - Mounts the `<CakedPoster>` client island. The actual posting goes
 *    through `/api/otter/caked/post` which calls the bot's
 *    `caked.message_post` verb — renderers are owned by the bot, the panel
 *    just picks a card kind + channel.
 *
 * Channel ID is a raw snowflake text input for MVP; a `<ChannelPicker>`
 * dropdown lands with Wave 7d once `channels.list` exists.
 */
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/session'
import { resolveAccess } from '@/lib/auth/perms'
import { CakedPoster } from './CakedPoster'
import { BusinessMessageEditor } from '@/components/otter/BusinessMessageEditor'
import { loadBusinessMessages } from '@/lib/otter/businessMessages'

export const dynamic = 'force-dynamic'

const CAKED_SLUG = 'caked-up'

export default async function CakedMessagingPage() {
  const session = await getSession()
  if (!session) redirect('/api/auth/login')

  const access = await resolveAccess(session)
  const rank = access.otter.businesses[CAKED_SLUG]
  const allowed =
    access.botOwner || rank === 'manager' || rank === 'owner'

  if (!allowed) {
    return (
      <main className="min-h-dvh p-6 sm:p-10">
        <div className="max-w-md mx-auto rounded-2xl border border-line bg-bg-card p-6 flex flex-col gap-3">
          <h1 className="text-xl font-semibold">Not authorized</h1>
          <p className="text-ink-dim text-sm">
            The Caked messaging page is restricted to Caked Up managers (and
            the bot owner). If you should have access, ask an owner to grant
            you the manager role mapping for <code>caked-up</code>.
          </p>
          <Link href="/me" className="text-sm text-accent underline self-start">
            ← Back to dashboard
          </Link>
        </div>
      </main>
    )
  }

  // Fetch editable message list via RPC. Best-effort — if the bot is
  // unreachable we still render the post-to-channel form below.
  const messagesResult = await loadBusinessMessages(CAKED_SLUG, access.actor.id)

  return (
    <main className="min-h-dvh p-6 sm:p-10">
      <div className="max-w-5xl mx-auto flex flex-col gap-6">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">Caked Messaging</h1>
          <p className="text-sm text-ink-dim max-w-2xl">
            Edit the Caked Up card bodies that <code>/caked</code> renders, or
            post a card directly to a Discord channel. The contact, event,
            and pricing cards are the same Components V2 layouts the bot
            renders — single source of truth on the bot side. Announcements
            are free-form text wrapped in the Caked brand container.
          </p>
        </header>

        {messagesResult.ok ? (
          <BusinessMessageEditor
            items={messagesResult.items}
            updateUrl="/api/otter/caked/messages"
            resetUrl="/api/otter/caked/messages/reset"
            title="Edit message content"
            description="Saves apply within ~60 s to the next /caked button press. Reset removes your override so the card falls back to the bot default."
          />
        ) : (
          <section className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-200">
            <p className="font-medium mb-1">Couldn&apos;t load editor</p>
            <p className="text-xs text-amber-200/80">
              The bot returned <code className="font-mono">{messagesResult.error}</code>. You can
              still post cards below — the bot will render the latest saved
              text.
            </p>
          </section>
        )}

        <div className="rounded-xl border border-line bg-bg-card2/40 p-3 text-xs text-ink-dim">
          <p className="mb-1 font-medium uppercase tracking-wider text-ink">
            Tip
          </p>
          <p>
            Use the channel ID from Discord (Developer Mode → right-click
            channel → Copy Channel ID). The bot only posts to text-capable
            channels — categories and forum roots return a friendly error.
          </p>
        </div>

        <CakedPoster />
      </div>
    </main>
  )
}

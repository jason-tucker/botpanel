'use client'
/**
 * RecordStandingForm — client-side wrapper around `<ServerForm>` for the
 * "Record standing" widget on `/otter/businesses/[slug]/standings`.
 *
 * Lives in its own file so the standings page (a server component) can stay
 * a server component — `<ServerForm>` is `'use client'` and pulls in
 * router/refresh state that doesn't belong on the server tree.
 *
 * On success we call `router.refresh()` so the standings table re-renders
 * with the new/updated row without a full reload. The form does NOT reset
 * — re-submitting the same character with a different standing should be
 * trivial, and clearing the inputs every save would punish that flow.
 */
import { useRouter } from 'next/navigation'
import { ServerForm } from '@/lib/forms/ServerForm'

export function RecordStandingForm({ slug }: { slug: string }) {
  const router = useRouter()
  return (
    <ServerForm
      action={`/api/otter/businesses/${slug}/standings`}
      method="POST"
      onSuccess={() => router.refresh()}
      className="grid grid-cols-1 sm:grid-cols-2 gap-3"
    >
      <label className="flex flex-col gap-1 text-xs text-ink-dim">
        <span>Character ID</span>
        <input
          type="text"
          name="characterId"
          required
          maxLength={200}
          placeholder="e.g. char_abc123"
          className="rounded-lg border border-line bg-bg-card2 px-3 py-2 text-sm text-ink placeholder:text-ink-dim/70 focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-ink-dim">
        <span>Character name (optional)</span>
        <input
          type="text"
          name="characterName"
          maxLength={200}
          placeholder="Display name shown in lists"
          className="rounded-lg border border-line bg-bg-card2 px-3 py-2 text-sm text-ink placeholder:text-ink-dim/70 focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-ink-dim">
        <span>Standing</span>
        <select
          name="standing"
          required
          defaultValue="neutral"
          className="rounded-lg border border-line bg-bg-card2 px-3 py-2 text-sm text-ink focus:outline-none focus:ring-1 focus:ring-accent"
        >
          <option value="good">good</option>
          <option value="neutral">neutral</option>
          <option value="bad">bad</option>
          <option value="blacklisted">blacklisted</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-ink-dim sm:col-span-2">
        <span>Reason (optional)</span>
        <input
          type="text"
          name="reason"
          maxLength={2000}
          placeholder="Short reason — visible to anyone with access here"
          className="rounded-lg border border-line bg-bg-card2 px-3 py-2 text-sm text-ink placeholder:text-ink-dim/70 focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </label>
      <div className="sm:col-span-2 flex justify-end">
        <button
          type="submit"
          className="rounded-lg border border-accent/40 bg-accent/15 hover:bg-accent/25 px-4 py-2 text-sm text-accent font-medium"
        >
          Save standing
        </button>
      </div>
    </ServerForm>
  )
}

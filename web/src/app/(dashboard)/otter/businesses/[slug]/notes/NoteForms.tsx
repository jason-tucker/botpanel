'use client'
/**
 * Client widgets for `/otter/businesses/[slug]/notes`:
 *
 *  - `<AddNoteForm>` — top-of-page "Add note" form. The visibility `<select>`
 *    is limited to whatever the viewer is allowed to author at; the server
 *    re-validates anyway, but trimming the menu to the writable tiers avoids
 *    a "why is this disabled?" friction loop for staff.
 *  - `<DeleteNoteButton>` — per-card flip-to-confirm Delete. Two-step click
 *    so a stray tap on someone's name doesn't blow away a note. Wraps the
 *    DELETE call in `<ServerForm method="DELETE">` so CSRF + error surfacing
 *    + disabled-while-submitting all come for free.
 *
 * Both call `router.refresh()` on success so the server-rendered list
 * re-renders with the new state. We don't try optimistic updates: notes
 * volume per session is low, and trust-the-server keeps the UI aligned
 * with the audit log.
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ServerForm } from '@/lib/forms/ServerForm'

export type NoteVisibility = 'staff' | 'manager' | 'owner'

export function AddNoteForm({
  slug,
  writableVisibilities,
}: {
  slug: string
  writableVisibilities: NoteVisibility[]
}) {
  const router = useRouter()
  // Default to the lowest tier the user can write — staff is the most common
  // case in practice, and a manager about to author a manager-tier note can
  // just flip the select once.
  const defaultVisibility = writableVisibilities[0] ?? 'staff'

  return (
    <ServerForm
      action={`/api/otter/businesses/${slug}/notes`}
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
        <span>Visibility</span>
        <select
          name="visibility"
          required
          defaultValue={defaultVisibility}
          className="rounded-lg border border-line bg-bg-card2 px-3 py-2 text-sm text-ink focus:outline-none focus:ring-1 focus:ring-accent"
        >
          {writableVisibilities.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-ink-dim sm:col-span-2">
        <span>Content (max 4000 chars)</span>
        <textarea
          name="content"
          required
          maxLength={3999}
          rows={4}
          placeholder="What happened?"
          className="rounded-lg border border-line bg-bg-card2 px-3 py-2 text-sm text-ink placeholder:text-ink-dim/70 focus:outline-none focus:ring-1 focus:ring-accent resize-y"
        />
      </label>
      <div className="sm:col-span-2 flex justify-end">
        <button
          type="submit"
          className="rounded-lg border border-accent/40 bg-accent/15 hover:bg-accent/25 px-4 py-2 text-sm text-accent font-medium"
        >
          Add note
        </button>
      </div>
    </ServerForm>
  )
}

export function DeleteNoteButton({
  slug,
  noteId,
}: {
  slug: string
  noteId: string
}) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded-md border border-err/30 bg-err/10 hover:bg-err/20 px-2 py-1 text-xs text-err"
        title="Delete this note"
      >
        Delete
      </button>
    )
  }

  return (
    <ServerForm
      action={`/api/otter/businesses/${slug}/notes/${noteId}`}
      method="DELETE"
      onSuccess={() => {
        setConfirming(false)
        router.refresh()
      }}
      className="inline-flex items-center gap-1"
    >
      <span className="text-xs text-err">Confirm?</span>
      <button
        type="submit"
        className="rounded-md border border-err/40 bg-err/15 hover:bg-err/25 px-2 py-1 text-xs text-err font-medium"
      >
        Yes
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="rounded-md border border-line text-ink-dim text-xs px-2 py-1 hover:text-ink"
      >
        Cancel
      </button>
    </ServerForm>
  )
}

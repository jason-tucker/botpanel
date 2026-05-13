'use client'

/**
 * <ReportForm bot="squishy" | "otter"> — single-bot report form.
 *
 * Field set mirrors each bot's `/report` slash modal exactly:
 *   - Title (required, 5–200 chars)
 *   - Type (select: bug / feature / question — values match the bot's
 *     `startsWith` normalization)
 *   - Description (required, textarea, 10–2000 chars)
 *   - Steps (optional, textarea, max 1000 chars)
 *
 * Posts JSON to `/api/{bot}/report` via the shared `<ServerForm>` so the
 * route gets CSRF + rate limit + audit for free. On success we clear the
 * form (resetOnSuccess) so a confused user doesn't fire the same report
 * twice on accident.
 */
import { useState } from 'react'
import { ServerForm } from '@/lib/forms/ServerForm'

const inputCls =
  'w-full rounded-md border border-line bg-bg-card2 px-2 py-1.5 text-sm placeholder:text-ink-dim/50 focus:outline-none focus:ring-1 focus:ring-accent'
const labelCls = 'text-[11px] uppercase tracking-wider text-ink-dim'
const btnPrimary =
  'inline-flex items-center px-3 py-1.5 text-sm rounded-lg border border-line bg-bg-card2 text-ink hover:bg-bg-card2/70 transition-colors'

const TITLES = {
  squishy: 'Report to SquishyBot',
  otter: 'Report to OtterBot',
} as const

const HINTS = {
  squishy: 'Voice channels, games, profiles, staff requests, sudo settings — the multipurpose Discord bot.',
  otter: 'Lookup, employee management, OC stock, Caked, business roles — the staff-facing bot.',
} as const

export function ReportForm({ bot }: { bot: 'squishy' | 'otter' }) {
  const [submitted, setSubmitted] = useState(false)
  const idPrefix = `report-${bot}`
  const action = `/api/${bot}/report`

  return (
    <div className="rounded-xl border border-line bg-bg-card p-5">
      <div className="flex items-baseline justify-between mb-3 gap-3">
        <h2 className="text-base font-medium">{TITLES[bot]}</h2>
        <span className="text-[11px] text-ink-dim">audit-logged · DMs the owner</span>
      </div>
      <p className="text-xs text-ink-dim mb-3">{HINTS[bot]}</p>

      {submitted && (
        <div
          role="status"
          className="mb-3 rounded-md border border-ok/40 bg-ok/10 px-3 py-2 text-sm text-ok"
        >
          Sent to the bot owner for review. You&apos;ll get a Discord DM with the
          result once they approve or reject.
        </div>
      )}

      <ServerForm
        action={action}
        method="POST"
        resetOnSuccess
        onSuccess={() => setSubmitted(true)}
        className="flex flex-col gap-3"
      >
        <input type="hidden" name="_format" value="json" />

        <div className="flex flex-col gap-1">
          <label className={labelCls} htmlFor={`${idPrefix}-title`}>
            Title
          </label>
          <input
            id={`${idPrefix}-title`}
            name="title"
            type="text"
            required
            minLength={5}
            maxLength={200}
            placeholder="Short summary of the issue or request"
            className={inputCls}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className={labelCls} htmlFor={`${idPrefix}-type`}>
            Type
          </label>
          <select
            id={`${idPrefix}-type`}
            name="type"
            required
            defaultValue="bug"
            className={inputCls}
          >
            <option value="bug">Bug</option>
            <option value="feature">Feature request</option>
            <option value="question">Question</option>
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className={labelCls} htmlFor={`${idPrefix}-description`}>
            Description
          </label>
          <textarea
            id={`${idPrefix}-description`}
            name="description"
            required
            minLength={10}
            maxLength={2000}
            rows={5}
            placeholder="What happened? What did you expect?"
            className={inputCls}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className={labelCls} htmlFor={`${idPrefix}-steps`}>
            Steps to reproduce (optional)
          </label>
          <textarea
            id={`${idPrefix}-steps`}
            name="steps"
            maxLength={1000}
            rows={3}
            placeholder="1. Open … 2. Click … 3. ..."
            className={inputCls}
          />
        </div>

        <div>
          <button type="submit" className={btnPrimary}>
            Send report
          </button>
        </div>
      </ServerForm>
    </div>
  )
}

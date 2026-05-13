'use client'

/**
 * `<MemberColorRoleCard>` — set or clear the target member's curated
 * color role. Only mounted when the surrounding page has confirmed
 * `feature.color_roles` is enabled in `bot_settings`.
 *
 * The Set form posts `{ roleKey: <Discord role id> }` to
 * `/api/squishy/members/[id]/color-role`; the Clear button posts
 * `{ roleKey: null }` (sent as the empty-string `""` over the form so
 * the route's coercion turns it back into null — keeps the form shape
 * uniform with the rest of the editor).
 */
import { useRouter } from 'next/navigation'
import { ServerForm } from '@/lib/forms/ServerForm'

export type ColorRoleOption = {
  roleId: string
  label: string
}

const selectCls =
  'rounded border border-line bg-bg-card px-2 py-1 text-sm text-ink focus:outline-none focus:ring-1 focus:ring-accent'
const btnApply =
  'inline-flex items-center rounded border border-accent/30 bg-accent/15 px-3 py-1 text-xs text-accent hover:bg-accent/25'
const btnClear =
  'inline-flex items-center rounded border border-line bg-bg-card2 px-3 py-1 text-xs text-ink-dim hover:bg-bg-card2/70'

export function MemberColorRoleCard({
  userId,
  options,
  currentRoleId,
}: {
  userId: string
  options: ColorRoleOption[]
  currentRoleId: string | null
}) {
  const router = useRouter()

  if (options.length === 0) {
    return (
      <div className="text-sm text-ink-dim italic">
        No curated color roles configured yet. Add some via{' '}
        <code className="font-mono text-xs">/sudo → Settings → Color Roles</code>.
      </div>
    )
  }

  const defaultSelected = currentRoleId ?? options[0]?.roleId

  return (
    <div className="flex flex-wrap items-center gap-3">
      <ServerForm
        action={`/api/squishy/members/${userId}/color-role`}
        method="POST"
        onSuccess={() => router.refresh()}
        className="flex flex-wrap items-center gap-2"
      >
        <input type="hidden" name="_format" value="json" />
        <select
          name="roleKey"
          defaultValue={defaultSelected}
          className={selectCls}
          aria-label="Color role"
        >
          {options.map((o) => (
            <option key={o.roleId} value={o.roleId}>
              {o.label}
            </option>
          ))}
        </select>
        <button type="submit" className={btnApply}>
          Apply color
        </button>
      </ServerForm>

      <ServerForm
        action={`/api/squishy/members/${userId}/color-role`}
        method="POST"
        confirm="Clear every curated color role this user holds?"
        onSuccess={() => router.refresh()}
        className="inline"
      >
        <input type="hidden" name="_format" value="json" />
        {/* Empty string is coerced to null on the route. */}
        <input type="hidden" name="roleKey" value="" />
        <button type="submit" className={btnClear}>
          Clear color
        </button>
      </ServerForm>

      <span className="text-xs text-ink-dim">
        {currentRoleId
          ? `Currently set to ${options.find((o) => o.roleId === currentRoleId)?.label ?? currentRoleId}.`
          : 'No curated color role assigned.'}
      </span>
    </div>
  )
}

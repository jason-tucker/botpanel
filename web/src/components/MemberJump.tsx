'use client'
/**
 * MemberJump — inline "switch person" control for per-user pages.
 *
 * Wraps the existing `<MemberPicker>` typeahead; picking a member navigates
 * to `hrefFor(id)` (e.g. the same stats/profile page for the newly chosen
 * person) instead of writing a form field. Lives in the page header so
 * moving between people never requires going back to a directory page.
 *
 * `useTransition` keeps the picker responsive while the next page's server
 * render streams in — combined with the per-segment loading skeletons the
 * switch feels immediate.
 */
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { MemberPicker } from '@/components/pickers/MemberPicker'
import { cn } from '@/components/ui/cn'

export function MemberJump({
  hrefTemplate,
  placeholder = 'Switch member…',
  className,
}: {
  /** `{id}` is replaced with the picked member's snowflake. */
  hrefTemplate: string
  placeholder?: string
  className?: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  return (
    <div className={cn('w-56', pending && 'opacity-60', className)}>
      <MemberPicker
        name="member-jump"
        placeholder={placeholder}
        onChange={(id) => {
          if (!id) return
          startTransition(() => {
            router.push(hrefTemplate.replace('{id}', id))
          })
        }}
      />
    </div>
  )
}

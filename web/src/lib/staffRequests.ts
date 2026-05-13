/**
 * Server-side loader for a user's pending staff approvals.
 *
 * Shared by `/squishy/profiles/[id]/edit` (sudo + self) and `/me/staff`
 * (self-service standalone). The DB query is identical in both places —
 * lift to keep them in sync.
 *
 * Read-only: SELECTs the latest pending rows, classifies the JSON
 * `requested_data` shape (department / tier / legacy single-role) and
 * returns the panel-facing PendingStaffRequest shape.
 */
import { and, desc, eq } from 'drizzle-orm'
import { squishyDb, squishySchema } from '@/lib/db/squishy'
import { labelForDepartment, labelForTier } from '@/lib/squishyStaffRoles'
import type { PendingStaffRequest } from '@/app/(dashboard)/squishy/profiles/[id]/edit/StaffRequestCard'

export async function loadPendingStaffRequests(
  guildId: string,
  userId: string,
): Promise<PendingStaffRequest[]> {
  try {
    const rows = await squishyDb
      .select({
        id: squishySchema.staffApprovals.id,
        requestedData: squishySchema.staffApprovals.requestedData,
        createdAt: squishySchema.staffApprovals.createdAt,
      })
      .from(squishySchema.staffApprovals)
      .where(
        and(
          eq(squishySchema.staffApprovals.guildId, guildId),
          eq(squishySchema.staffApprovals.userId, userId),
          eq(squishySchema.staffApprovals.status, 'pending'),
        ),
      )
      .orderBy(desc(squishySchema.staffApprovals.createdAt))
    return rows.map((r) => {
      const d = (r.requestedData ?? {}) as {
        // New shape (post Wave 7b redesign)
        department_key?: string | null
        department_label?: string | null
        tier_key?: string | null
        tier_label?: string | null
        // Legacy shape (single-role rows pre-redesign)
        role_key?: string
        role_label?: string
        real_name?: string | null
      }

      let departmentLabel: string | null = null
      let tierLabel: string | null = null

      if (d.department_key) {
        const slug = d.department_key.replace(/^staff\.role\./, '')
        departmentLabel = d.department_label ?? labelForDepartment(slug) ?? slug
      }
      if (d.tier_key) {
        const slug = d.tier_key.replace(/^staff\.role\./, '')
        tierLabel = d.tier_label ?? labelForTier(slug) ?? slug
      }

      // Legacy fallback: a row predating the redesign carries a single
      // `role_key` that's either a department or a tier; classify it.
      if (!departmentLabel && !tierLabel && d.role_key) {
        const slug = d.role_key.replace(/^staff\.role\./, '')
        const tierGuess = labelForTier(slug)
        if (tierGuess) tierLabel = d.role_label ?? tierGuess
        else departmentLabel = d.role_label ?? labelForDepartment(slug) ?? slug
      }

      return {
        id: r.id,
        departmentLabel,
        tierLabel,
        realName: d.real_name ?? null,
        createdAt: r.createdAt,
      }
    })
  } catch (err) {
    console.warn('[loadPendingStaffRequests] failed', err)
    return []
  }
}

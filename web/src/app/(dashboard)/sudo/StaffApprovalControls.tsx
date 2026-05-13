/**
 * Re-export shim — the actual implementations live in
 * `@/components/staff/DirectStaffControls`, which both `/sudo` and the
 * new `/squishy/members/[id]` editor import. Keep this file so existing
 * imports (`./StaffApprovalControls`) keep working without a churn pass
 * across every consumer.
 */
export {
  ApproveButton,
  DenyButton,
  DirectGrantForm,
  DirectRevokeForm,
  STAFF_ROLE_SLUGS,
} from '@/components/staff/DirectStaffControls'

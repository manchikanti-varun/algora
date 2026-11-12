import { SuperAdminSection } from '@/features/super-admin/section';
import { AdminApprovals } from '@/features/admin-requests/review';
export const dynamic = 'force-dynamic';
export default function Approvals() {
  return (
    <SuperAdminSection
      active="Admin Approvals"
      title="Give good intentions a clear path."
      description="Review requests and grant precise, college-scoped access."
    >
      <AdminApprovals />
    </SuperAdminSection>
  );
}

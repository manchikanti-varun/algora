import { SuperAdminSection } from '@/features/super-admin/section';
import { AdminManagement } from '@/features/admin-management/management';
export const dynamic = 'force-dynamic';
export default function Admins() {
  return (
    <SuperAdminSection
      active="Admin Management"
      title="The right access. In the right hands."
      description="Review administrator scope, permissions and account lifecycle."
    >
      <AdminManagement />
    </SuperAdminSection>
  );
}

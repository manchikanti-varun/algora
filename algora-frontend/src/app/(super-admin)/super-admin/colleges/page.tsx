import { SuperAdminSection } from '@/features/super-admin/section';
import { CollegeManagement } from '@/features/colleges/management';
export const dynamic = 'force-dynamic';
export default function Colleges() {
  return (
    <SuperAdminSection
      active="Colleges"
      title="Communities, connected."
      description="Manage college identity, status and historical records."
    >
      <CollegeManagement />
    </SuperAdminSection>
  );
}

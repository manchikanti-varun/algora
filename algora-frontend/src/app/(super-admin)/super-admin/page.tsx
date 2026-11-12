import { SuperAdminSection } from '@/features/super-admin/section';
import { SuperAdminOverview } from '@/features/super-admin/overview';
export const dynamic = 'force-dynamic';
export default async function SuperAdmin() {
  return (
    <SuperAdminSection
      active="Overview"
      title="A clear view. A stronger platform."
      description="Live college, administrator and access-request activity across Algora."
    >
      <SuperAdminOverview />
    </SuperAdminSection>
  );
}

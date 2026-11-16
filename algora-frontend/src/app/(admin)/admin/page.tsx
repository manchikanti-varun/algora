import { OperationalDashboard } from '@/features/analytics/dashboard';
import { requireWorkspace } from '@/features/auth/server';
import { AdministrationShell } from '@/components/layout/administration-shell';
import { OwnAdminScope } from '@/features/admin-management/own-scope';
export const dynamic = 'force-dynamic';
export default async function Admin() {
  await requireWorkspace('ADMIN');
  return (
    <AdministrationShell
      role="ADMIN"
      active="Overview"
      title="College operations"
      description="View only the colleges and permissions currently assigned to your account."
    >
      <OperationalDashboard />
      <OwnAdminScope />
    </AdministrationShell>
  );
}

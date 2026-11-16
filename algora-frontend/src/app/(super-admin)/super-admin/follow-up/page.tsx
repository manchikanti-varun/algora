import { requireWorkspace } from '@/features/auth/server';
import { AdministrationShell } from '@/components/layout/administration-shell';
import { OperationalDashboard } from '@/features/analytics/dashboard';
export const dynamic = 'force-dynamic';
export default async function Page() {
  await requireWorkspace('SUPER_ADMIN');
  return (
    <AdministrationShell
      role="SUPER_ADMIN"
      active="Follow-up"
      title="Student follow-up"
      description="Authoritative attendance and verified coding evidence for your current scope."
    >
      <OperationalDashboard superAdmin followUp />
    </AdministrationShell>
  );
}

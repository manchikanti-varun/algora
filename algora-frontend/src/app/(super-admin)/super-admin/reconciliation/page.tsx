import { requireWorkspace } from '@/features/auth/server';
import { AdministrationShell } from '@/components/layout/administration-shell';
import { ReconciliationStatus } from '@/features/learning/reconciliation';
export const dynamic = 'force-dynamic';
export default async function Page() {
  await requireWorkspace('SUPER_ADMIN');
  return (
    <AdministrationShell
      role="SUPER_ADMIN"
      active="Reconciliation"
      title="Enrollment reconciliation"
      description="Durable work and explicit failure visibility."
    >
      <ReconciliationStatus />
    </AdministrationShell>
  );
}

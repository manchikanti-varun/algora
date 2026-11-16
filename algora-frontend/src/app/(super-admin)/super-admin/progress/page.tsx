import { requireWorkspace } from '@/features/auth/server';
import { AdministrationShell } from '@/components/layout/administration-shell';
import { ProgressBatches } from '@/features/coding/progress';
export const dynamic = 'force-dynamic';
export default async function Page() {
  await requireWorkspace('SUPER_ADMIN');
  return (
    <AdministrationShell
      role="SUPER_ADMIN"
      active="Coding Progress"
      title="Verified coding progress"
      description="Trusted submission evidence and transparent verification coverage."
    >
      <ProgressBatches staff superAdmin={true} reports={false} />
    </AdministrationShell>
  );
}

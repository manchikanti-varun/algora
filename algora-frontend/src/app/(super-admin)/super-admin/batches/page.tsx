import { requireWorkspace } from '@/features/auth/server';
import { AdministrationShell } from '@/components/layout/administration-shell';
import { BatchCatalog } from '@/features/learning/batches';
export const dynamic = 'force-dynamic';
export default async function Page() {
  await requireWorkspace('SUPER_ADMIN');
  return (
    <AdministrationShell
      role="SUPER_ADMIN"
      active="Batches"
      title="College batches"
      description="Authorized programs, college delivery and roll-number-based membership."
    >
      <BatchCatalog superAdmin />
    </AdministrationShell>
  );
}

import { requireWorkspace } from '@/features/auth/server';
import { AdministrationShell } from '@/components/layout/administration-shell';
import { BatchDetail } from '@/features/learning/batches';
export const dynamic = 'force-dynamic';
export default async function Page({
  params,
}: {
  params: Promise<{ batchId: string }>;
}) {
  await requireWorkspace('SUPER_ADMIN');
  const { batchId } = await params;
  return (
    <AdministrationShell
      role="SUPER_ADMIN"
      active="Batches"
      title="Batch details"
      description="Authorized programs, college delivery and roll-number-based membership."
    >
      <BatchDetail superAdmin id={batchId} />
    </AdministrationShell>
  );
}

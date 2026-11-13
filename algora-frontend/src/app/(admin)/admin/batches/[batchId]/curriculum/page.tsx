import { requireWorkspace } from '@/features/auth/server';
import { AdministrationShell } from '@/components/layout/administration-shell';
import { BatchCurriculum } from '@/features/curriculum/batch-assignment';
export const dynamic = 'force-dynamic';
export default async function Page({
  params,
}: {
  params: Promise<{ batchId: string }>;
}) {
  await requireWorkspace('ADMIN');
  const { batchId } = await params;
  return (
    <AdministrationShell
      role="ADMIN"
      active="Batches"
      title="Batch curriculum"
      description="Author, review and deliver immutable learning content."
    >
      <BatchCurriculum batchId={batchId} />
    </AdministrationShell>
  );
}

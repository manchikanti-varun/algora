import { requireWorkspace } from '@/features/auth/server';
import { StaffProgress } from '@/features/coding/progress';
import { AdministrationShell } from '@/components/layout/administration-shell';
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
      active="Coding Progress"
      title="Verified coding progress"
      description="Current enrollment, trusted evidence and provider health."
    >
      <StaffProgress batchId={batchId} />
    </AdministrationShell>
  );
}

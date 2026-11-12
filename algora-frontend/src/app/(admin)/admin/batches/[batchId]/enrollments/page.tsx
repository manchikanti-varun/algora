import { requireWorkspace } from '@/features/auth/server';
import { AdministrationShell } from '@/components/layout/administration-shell';
import { EnrollmentWorkspace } from '@/features/learning/enrollments';
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
      title="Enrollment workspace"
      description="Authorized programs, college delivery and roll-number-based membership."
    >
      <EnrollmentWorkspace id={batchId} />
    </AdministrationShell>
  );
}

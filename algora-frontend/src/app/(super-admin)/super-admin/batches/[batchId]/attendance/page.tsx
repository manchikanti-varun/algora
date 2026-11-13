import { requireWorkspace } from '@/features/auth/server';
import { AdministrationShell } from '@/components/layout/administration-shell';
import { AttendanceDashboard } from '@/features/attendance/dashboard';
export const dynamic = 'force-dynamic';
export default async function Page({
  params,
}: {
  params: Promise<{ batchId: string }>;
}) {
  await requireWorkspace('SUPER_ADMIN');
  const p = await params;
  return (
    <AdministrationShell
      role="SUPER_ADMIN"
      active="Attendance"
      title="Batch attendance"
      description="Authorized in-person attendance, stable rosters and clear official records."
    >
      <AttendanceDashboard superAdmin={true} batchId={p.batchId} />
    </AdministrationShell>
  );
}

import { requireWorkspace } from '@/features/auth/server';
import { AdministrationShell } from '@/components/layout/administration-shell';
import { AttendanceReports } from '@/features/attendance/reports';
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
      title="Attendance reports"
      description="Authorized in-person attendance, stable rosters and clear official records."
    >
      <AttendanceReports superAdmin={true} batchId={p.batchId} />
    </AdministrationShell>
  );
}

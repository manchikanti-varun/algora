import { requireWorkspace } from '@/features/auth/server';
import { AdministrationShell } from '@/components/layout/administration-shell';
import { AttendanceHub } from '@/features/attendance/dashboard';
export const dynamic = 'force-dynamic';
export default async function Page() {
  await requireWorkspace('SUPER_ADMIN');
  return (
    <AdministrationShell
      role="SUPER_ADMIN"
      active="Attendance"
      title="Attendance"
      description="Authorized in-person attendance, stable rosters and clear official records."
    >
      <AttendanceHub superAdmin={true} />
    </AdministrationShell>
  );
}

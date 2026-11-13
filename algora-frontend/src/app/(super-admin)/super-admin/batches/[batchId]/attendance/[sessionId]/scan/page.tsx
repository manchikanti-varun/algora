import { requireWorkspace } from '@/features/auth/server';
import { AdministrationShell } from '@/components/layout/administration-shell';
import { AttendanceScanner } from '@/features/attendance/scanner';
export const dynamic = 'force-dynamic';
export default async function Page({
  params,
}: {
  params: Promise<{ batchId: string; sessionId: string }>;
}) {
  await requireWorkspace('SUPER_ADMIN');
  const p = await params;
  return (
    <AdministrationShell
      role="SUPER_ADMIN"
      active="Attendance"
      title="Continuous QR scanner"
      description="Authorized in-person attendance, stable rosters and clear official records."
    >
      <AttendanceScanner
        superAdmin={true}
        batchId={p.batchId}
        sessionId={p.sessionId}
      />
    </AdministrationShell>
  );
}

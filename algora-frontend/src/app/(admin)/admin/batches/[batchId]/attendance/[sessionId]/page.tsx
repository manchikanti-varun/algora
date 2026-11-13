import { requireWorkspace } from '@/features/auth/server';
import { AdministrationShell } from '@/components/layout/administration-shell';
import { AttendanceReview } from '@/features/attendance/review';
export const dynamic = 'force-dynamic';
export default async function Page({
  params,
}: {
  params: Promise<{ batchId: string; sessionId: string }>;
}) {
  await requireWorkspace('ADMIN');
  const p = await params;
  return (
    <AdministrationShell
      role="ADMIN"
      active="Attendance"
      title="Attendance review"
      description="Authorized in-person attendance, stable rosters and clear official records."
    >
      <AttendanceReview
        superAdmin={false}
        batchId={p.batchId}
        sessionId={p.sessionId}
      />
    </AdministrationShell>
  );
}

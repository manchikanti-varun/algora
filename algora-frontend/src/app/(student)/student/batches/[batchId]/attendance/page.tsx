import { requireWorkspace } from '@/features/auth/server';
import { StudentAttendance } from '@/features/attendance/student';
export const dynamic = 'force-dynamic';
export default async function Page({
  params,
}: {
  params: Promise<{ batchId: string }>;
}) {
  await requireWorkspace('STUDENT');
  const { batchId } = await params;
  return <StudentAttendance batchId={batchId} />;
}

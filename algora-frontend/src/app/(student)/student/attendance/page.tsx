import { requireWorkspace } from '@/features/auth/server';
import { StudentAttendanceBatches } from '@/features/attendance/student';
export const dynamic = 'force-dynamic';
export default async function Page() {
  await requireWorkspace('STUDENT');
  return <StudentAttendanceBatches />;
}

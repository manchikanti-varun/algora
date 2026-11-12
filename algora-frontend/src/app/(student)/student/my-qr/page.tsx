import { requireStudentPage } from '@/features/students/server';
import { StudentQr } from '@/features/students/qr';
export const dynamic = 'force-dynamic';
export default async function Page() {
  await requireStudentPage();
  return <StudentQr />;
}

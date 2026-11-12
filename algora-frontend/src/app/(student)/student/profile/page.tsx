import { requireStudentPage } from '@/features/students/server';
import { StudentProfilePage } from '@/features/students/profile';
export const dynamic = 'force-dynamic';
export default async function Page() {
  await requireStudentPage();
  return <StudentProfilePage />;
}

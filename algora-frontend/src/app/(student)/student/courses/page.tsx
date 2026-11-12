import { requireStudentPage } from '@/features/students/server';
import { StudentLearning } from '@/features/learning/student';
export const dynamic = 'force-dynamic';
export default async function Page() {
  await requireStudentPage();
  return <StudentLearning view="courses" />;
}

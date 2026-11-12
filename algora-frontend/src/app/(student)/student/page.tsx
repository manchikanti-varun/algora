import { requireWorkspace } from '@/features/auth/server';
import { StudentLearning } from '@/features/learning/student';
export const dynamic = 'force-dynamic';
export default async function Student() {
  await requireWorkspace('STUDENT');
  return <StudentLearning />;
}

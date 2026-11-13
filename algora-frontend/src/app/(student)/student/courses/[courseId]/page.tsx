import { requireWorkspace } from '@/features/auth/server';
import { StudentCourse } from '@/features/curriculum/student';
export const dynamic = 'force-dynamic';
export default async function Page({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  await requireWorkspace('STUDENT');
  const p = await params;
  return <StudentCourse id={p.courseId} />;
}

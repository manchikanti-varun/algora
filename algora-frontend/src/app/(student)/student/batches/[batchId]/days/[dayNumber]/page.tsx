import { requireWorkspace } from '@/features/auth/server';
import { StudentLearningDay } from '@/features/curriculum/student';
export const dynamic = 'force-dynamic';
export default async function Page({
  params,
}: {
  params: Promise<{ batchId: string; dayNumber: string }>;
}) {
  await requireWorkspace('STUDENT');
  const p = await params;
  return (
    <StudentLearningDay batchId={p.batchId} number={Number(p.dayNumber)} />
  );
}

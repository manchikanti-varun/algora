import { requireWorkspace } from '@/features/auth/server';
import { StudentBatch } from '@/features/curriculum/student';
export const dynamic = 'force-dynamic';
export default async function Page({
  params,
}: {
  params: Promise<{ batchId: string }>;
}) {
  await requireWorkspace('STUDENT');
  const p = await params;
  return <StudentBatch id={p.batchId} />;
}

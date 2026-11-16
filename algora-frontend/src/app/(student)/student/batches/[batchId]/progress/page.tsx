import { requireWorkspace } from '@/features/auth/server';
import { StudentProgress } from '@/features/coding/progress';
export const dynamic = 'force-dynamic';
export default async function Page({
  params,
}: {
  params: Promise<{ batchId: string }>;
}) {
  await requireWorkspace('STUDENT');
  const { batchId } = await params;
  return <StudentProgress batchId={batchId} />;
}

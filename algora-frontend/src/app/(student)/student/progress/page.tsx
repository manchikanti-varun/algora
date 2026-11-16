import { requireWorkspace } from '@/features/auth/server';
import { ProgressBatches } from '@/features/coding/progress';
export const dynamic = 'force-dynamic';
export default async function Page() {
  await requireWorkspace('STUDENT');
  return <ProgressBatches />;
}

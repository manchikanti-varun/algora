import { requireWorkspace } from '@/features/auth/server';
import { PersonalAnalytics } from '@/features/analytics/dashboard';
export const dynamic = 'force-dynamic';
export default async function Student() {
  await requireWorkspace('STUDENT');
  return <PersonalAnalytics />;
}

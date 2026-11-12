import { requireWorkspace } from '@/features/auth/server';
import { Workspace } from '@/features/auth/workspace';
export const dynamic = 'force-dynamic';
export default async function Student() {
  const { user } = await requireWorkspace('STUDENT');
  return <Workspace role="STUDENT" user={user} />;
}

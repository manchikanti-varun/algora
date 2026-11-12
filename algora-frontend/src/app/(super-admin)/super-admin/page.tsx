import { requireWorkspace } from '@/features/auth/server';
import { Workspace } from '@/features/auth/workspace';
export const dynamic = 'force-dynamic';
export default async function SuperAdmin() {
  const { user } = await requireWorkspace('SUPER_ADMIN');
  return <Workspace role="SUPER_ADMIN" user={user} />;
}

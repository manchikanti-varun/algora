import { requireWorkspace } from '@/features/auth/server';
import { Workspace } from '@/features/auth/workspace';
export const dynamic = 'force-dynamic';
export default async function Admin() {
  const { user } = await requireWorkspace('ADMIN');
  return <Workspace role="ADMIN" user={user} />;
}

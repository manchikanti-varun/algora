import { redirect } from 'next/navigation';
import { requireSession } from '@/features/auth/server';
import { AdminAccessPage } from '@/features/admin-requests/request-page';
export const dynamic = 'force-dynamic';
export default async function RequestAdminAccess() {
  const session = await requireSession();
  if (session.user.role !== 'STUDENT') redirect(session.destination);
  return <AdminAccessPage user={session.user} />;
}

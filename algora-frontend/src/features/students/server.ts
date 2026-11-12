import 'server-only';
import { redirect } from 'next/navigation';
import { requireSession } from '@/features/auth/server';
export async function requireStudentPage(registration = false) {
  const result = await requireSession();
  const u = result.user;
  if (u.role !== 'STUDENT') redirect(result.destination);
  const registered = !['NOT_STARTED', 'INCOMPLETE'].includes(
    u.registrationStatus,
  );
  if (registration && registered) redirect('/student/profile');
  if (!registration && !registered) redirect('/student/register');
  return result;
}

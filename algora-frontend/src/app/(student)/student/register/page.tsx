import { requireStudentPage } from '@/features/students/server';
import { Registration } from '@/features/students/registration';
export const dynamic = 'force-dynamic';
export default async function Page() {
  await requireStudentPage(true);
  return <Registration />;
}

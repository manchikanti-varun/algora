import { requireWorkspace } from '@/features/auth/server';
import { AdministrationShell } from '@/components/layout/administration-shell';
import { StudentManagement } from '@/features/students/management';
export const dynamic = 'force-dynamic';
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireWorkspace('ADMIN');
  const query = await searchParams;
  const initialSearch =
    typeof query.search === 'string' ? query.search.slice(0, 100) : '';
  return (
    <AdministrationShell
      role="ADMIN"
      active="Students"
      title="Student identities"
      description="Review identity and corrections within your authorized college scope."
    >
      <StudentManagement initialSearch={initialSearch} />
    </AdministrationShell>
  );
}

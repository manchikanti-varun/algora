import { requireWorkspace } from '@/features/auth/server';
import { AdministrationShell } from '@/components/layout/administration-shell';
import { StudentManagement } from '@/features/students/management';
export const dynamic = 'force-dynamic';
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireWorkspace('SUPER_ADMIN');
  const query = await searchParams;
  const initialSearch =
    typeof query.search === 'string' ? query.search.slice(0, 100) : '';
  return (
    <AdministrationShell
      role="SUPER_ADMIN"
      active="Students"
      title="Student identities"
      description="Review institutional identity and protected corrections across colleges."
    >
      <StudentManagement superAdmin initialSearch={initialSearch} />
    </AdministrationShell>
  );
}

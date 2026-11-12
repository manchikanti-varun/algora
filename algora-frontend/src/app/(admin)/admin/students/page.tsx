import { requireWorkspace } from '@/features/auth/server';
import { AdministrationShell } from '@/components/layout/administration-shell';
import { StudentManagement } from '@/features/students/management';
export const dynamic = 'force-dynamic';
export default async function Page() {
  await requireWorkspace('ADMIN');
  return (
    <AdministrationShell
      role="ADMIN"
      active="Students"
      title="Student identities"
      description="Review identity and corrections within your authorized college scope."
    >
      <StudentManagement />
    </AdministrationShell>
  );
}

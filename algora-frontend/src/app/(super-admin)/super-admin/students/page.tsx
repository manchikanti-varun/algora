import { requireWorkspace } from '@/features/auth/server';
import { AdministrationShell } from '@/components/layout/administration-shell';
import { StudentManagement } from '@/features/students/management';
export const dynamic = 'force-dynamic';
export default async function Page() {
  await requireWorkspace('SUPER_ADMIN');
  return (
    <AdministrationShell
      role="SUPER_ADMIN"
      active="Students"
      title="Student identities"
      description="Review institutional identity and protected corrections across colleges."
    >
      <StudentManagement superAdmin />
    </AdministrationShell>
  );
}

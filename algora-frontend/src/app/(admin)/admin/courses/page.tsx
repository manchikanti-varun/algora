import { requireWorkspace } from '@/features/auth/server';
import { AdministrationShell } from '@/components/layout/administration-shell';
import { CourseCatalog } from '@/features/learning/courses';
export const dynamic = 'force-dynamic';
export default async function Page() {
  await requireWorkspace('ADMIN');
  return (
    <AdministrationShell
      role="ADMIN"
      active="Courses"
      title="Course catalog"
      description="Authorized programs, college delivery and roll-number-based membership."
    >
      <CourseCatalog />
    </AdministrationShell>
  );
}

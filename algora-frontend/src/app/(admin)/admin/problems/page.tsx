import { requireWorkspace } from '@/features/auth/server';
import { AdministrationShell } from '@/components/layout/administration-shell';
import { ProblemCatalog } from '@/features/curriculum/problems';
export const dynamic = 'force-dynamic';
export default async function Page() {
  await requireWorkspace('ADMIN');
  return (
    <AdministrationShell
      role="ADMIN"
      active="Problems"
      title="Problem catalog"
      description="Author, review and deliver immutable learning content."
    >
      <ProblemCatalog superAdmin={false} />
    </AdministrationShell>
  );
}

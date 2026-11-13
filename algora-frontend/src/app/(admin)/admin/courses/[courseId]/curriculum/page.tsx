import { requireWorkspace } from '@/features/auth/server';
import { AdministrationShell } from '@/components/layout/administration-shell';
import { CurriculumBuilder } from '@/features/curriculum/builder';
export const dynamic = 'force-dynamic';
export default async function Page({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  await requireWorkspace('ADMIN');
  const { courseId } = await params;
  return (
    <AdministrationShell
      role="ADMIN"
      active="Courses"
      title="Curriculum builder"
      description="Author, review and deliver immutable learning content."
    >
      <CurriculumBuilder courseId={courseId} superAdmin={false} />
    </AdministrationShell>
  );
}

import { requireWorkspace } from '@/features/auth/server';
import { AdministrationShell } from '@/components/layout/administration-shell';
import { BatchAnalytics } from '@/features/analytics/dashboard';
export const dynamic = 'force-dynamic';
export default async function Page({
  params,
}: {
  params: Promise<{ batchId: string }>;
}) {
  await requireWorkspace('ADMIN');
  const { batchId } = await params;
  return (
    <AdministrationShell
      role="ADMIN"
      active="Analytics"
      title="Learning analytics"
      description="Authoritative attendance and verified coding evidence for your current scope."
    >
      <BatchAnalytics batchId={batchId} />
    </AdministrationShell>
  );
}

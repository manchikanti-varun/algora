import { notFound } from 'next/navigation';
import { navigation, type PreviewRole } from '@/config/navigation';
import { DashboardShell } from '@/components/layout/dashboard-shell';
export const dynamic = 'force-dynamic';
export default async function Preview({
  params,
}: {
  params: Promise<{ role: string }>;
}) {
  if (
    process.env.NODE_ENV !== 'development' ||
    process.env.ENABLE_PREVIEW_ROUTES !== 'true'
  )
    notFound();
  const { role } = await params;
  if (!Object.hasOwn(navigation, role)) notFound();
  return <DashboardShell role={role as PreviewRole} />;
}

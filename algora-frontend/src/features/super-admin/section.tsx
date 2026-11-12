import { requireWorkspace } from '@/features/auth/server';
import { AdministrationShell } from '@/components/layout/administration-shell';
export async function SuperAdminSection({
  active,
  title,
  description,
  children,
}: {
  active: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  await requireWorkspace('SUPER_ADMIN');
  return (
    <AdministrationShell
      role="SUPER_ADMIN"
      active={active}
      title={title}
      description={description}
    >
      {children}
    </AdministrationShell>
  );
}

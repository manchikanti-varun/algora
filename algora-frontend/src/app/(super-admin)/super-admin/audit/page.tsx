import { SuperAdminSection } from '@/features/super-admin/section';
import { AuditView } from '@/features/audit/view';
export const dynamic = 'force-dynamic';
export default function Audit() {
  return (
    <SuperAdminSection
      active="Audit Logs"
      title="Every change, accounted for."
      description="An append-only record of important platform decisions."
    >
      <AuditView />
    </SuperAdminSection>
  );
}

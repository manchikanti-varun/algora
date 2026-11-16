import { requireWorkspace } from '@/features/auth/server';
import { CodingAccounts } from '@/features/coding/accounts';
export const dynamic = 'force-dynamic';
export default async function Page() {
  await requireWorkspace('STUDENT');
  return <CodingAccounts />;
}

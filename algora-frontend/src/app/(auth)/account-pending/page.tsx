import { redirect } from 'next/navigation';
import { requireSession } from '@/features/auth/server';
import { AccountState } from '@/features/auth/account-state';
export const dynamic = 'force-dynamic';
export default async function AccountPending() {
  const session = await requireSession();
  if (session.destination !== '/account-pending') redirect(session.destination);
  return (
    <AccountState
      signedIn
      title="A little patience. A clear next step."
      description="Your account is awaiting verification or activation. Workspace access will become available when the required review is complete."
    />
  );
}

import { redirect } from 'next/navigation';
import { requireSession } from '@/features/auth/server';
import { AccountState } from '@/features/auth/account-state';
export const dynamic = 'force-dynamic';
export default async function RegistrationRequired() {
  const session = await requireSession();
  if (session.destination !== '/registration-required')
    redirect(session.destination);
  return (
    <AccountState
      signedIn
      title="Identity verified. Your journey is next."
      description="Your Google account is connected. Student registration is required before accessing learning resources. Registration will open in a future phase."
    />
  );
}

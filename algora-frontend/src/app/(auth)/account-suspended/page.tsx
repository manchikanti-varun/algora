import { AccountState } from '@/features/auth/account-state';
export default function AccountSuspended() {
  return (
    <AccountState
      title="Your account needs attention."
      description="This account is suspended or archived and cannot access Algora workspaces. Contact your institution’s authorized platform administrator for assistance."
    />
  );
}

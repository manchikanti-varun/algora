import { AccountState } from '@/features/auth/account-state';
export default function Unauthorized() {
  return (
    <AccountState
      title="This workspace isn’t yours to open."
      description="Your account does not have permission to access this area. Signing in does not grant administrator privileges."
    />
  );
}

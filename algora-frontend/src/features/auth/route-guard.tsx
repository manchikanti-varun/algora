'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from './provider';
import { rolePaths, type Role } from './contracts';
import { ApiError } from '@/lib/api/client';
export function RouteGuard({
  role,
  children,
}: {
  role: Role;
  children: React.ReactNode;
}) {
  const auth = useAuth();
  const router = useRouter();
  const allowed =
    !!auth.user &&
    auth.user.role === role &&
    auth.destination === rolePaths[role] &&
    !auth.error;
  useEffect(() => {
    if (auth.loading) return;
    if (
      auth.error instanceof ApiError &&
      auth.error.code === 'ACCOUNT_SUSPENDED'
    )
      router.replace('/account-suspended');
    else if (auth.error)
      router.replace(
        auth.error instanceof ApiError && auth.error.status === 401
          ? '/login?reason=session-expired'
          : '/login?error=unavailable',
      );
    else if (!allowed)
      router.replace(
        auth.user?.role !== role
          ? '/unauthorized'
          : (auth.destination ?? '/login'),
      );
  }, [
    auth.loading,
    auth.error,
    auth.user,
    auth.destination,
    allowed,
    role,
    router,
  ]);
  if (auth.loading || !allowed)
    return (
      <div className="auth-loading" role="status">
        Verifying your secure session…
      </div>
    );
  return <>{children}</>;
}

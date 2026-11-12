'use client';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiGet } from '@/lib/api/client';
import { useAuth } from './provider';
import { statusSchema } from './contracts';
import { Button } from '@/components/ui/button';
import { ShieldCheck, LoaderCircle } from 'lucide-react';
import Link from 'next/link';
export function LoginEntry() {
  const auth = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const adminIntent = params.get('intent') === 'admin-access';
  const [starting, setStarting] = useState(false);
  const status = useQuery({
    queryKey: ['auth', 'status'],
    queryFn: ({ signal }) => apiGet('/auth/status', statusSchema, signal),
    retry: false,
    refetchInterval: 30000,
  });
  useEffect(() => {
    if (!auth.loading && auth.user && auth.destination)
      router.replace(
        adminIntent && auth.user.role === 'STUDENT'
          ? '/request-admin-access'
          : auth.destination,
      );
  }, [auth.loading, auth.user, auth.destination, router, adminIntent]);
  const message = status.isError
    ? 'The authentication service is unreachable. Please try again shortly.'
    : status.data?.message;
  return (
    <>
      <div className="auth-trust">
        <ShieldCheck size={16} /> A secure start to your learning journey
      </div>
      {params.get('reason') === 'session-expired' && (
        <div className="notice" role="status">
          <strong>Your session has ended.</strong>
          <p>Sign in again to pick up where you left off.</p>
        </div>
      )}
      {params.get('error') && (
        <div className="notice" role="alert">
          <strong>Sign-in is temporarily unavailable.</strong>
          <p>Please try again when the authentication service is ready.</p>
        </div>
      )}
      <Button
        className="google-button"
        variant="outline"
        disabled={
          auth.loading ||
          status.isPending ||
          !status.data?.available ||
          starting
        }
        onClick={() => {
          setStarting(true);
          auth.login(adminIntent ? 'admin-access' : undefined);
        }}
      >
        {starting || status.isPending ? (
          <LoaderCircle className="spin" size={18} />
        ) : (
          <span className="google-mark" aria-hidden="true">
            G
          </span>
        )}
        {starting ? 'Connecting to Google…' : 'Continue with Google'}
      </Button>
      <div className="notice" aria-live="polite">
        <strong>
          {status.isPending
            ? 'Checking sign-in availability…'
            : status.data?.available
              ? 'Your Google account. Your Algora journey.'
              : 'Sign-in is not ready yet.'}
        </strong>
        <p>{message ?? 'Checking the authentication service.'}</p>
      </div>
      {(status.isError || !status.data?.available) && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void status.refetch()}
          disabled={status.isFetching}
        >
          Check again
        </Button>
      )}
      <p className="auth-fine-print">
        We use Google to verify your identity. Registration and workspace access
        are reviewed separately.
      </p>
      <Link className="text-link" href="/login?intent=admin-access">
        {adminIntent
          ? 'Google sign-in will continue to your admin request'
          : 'Want to support your college? Request admin access'}
      </Link>
    </>
  );
}

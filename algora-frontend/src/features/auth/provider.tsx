'use client';
import { createContext, useContext } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { z } from 'zod';
import { apiGet, apiPost, ApiError } from '@/lib/api/client';
import { meSchema, type PublicUser } from './contracts';
import { env } from '@/config/env';
type AuthState = {
  user: PublicUser | null;
  destination?: string;
  loading: boolean;
  error: Error | null;
  login: () => void;
  logout: (all?: boolean) => Promise<void>;
  refresh: () => Promise<void>;
};
const AuthContext = createContext<AuthState | null>(null);
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const client = useQueryClient();
  const router = useRouter();
  const query = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: ({ signal }) => apiGet('/auth/me', meSchema, signal),
    retry: false,
    staleTime: 0,
    refetchInterval: 60000,
    refetchOnWindowFocus: 'always',
  });
  async function logout(all = false) {
    try {
      await apiPost(
        all ? '/auth/logout-all' : '/auth/logout',
        z.object({ loggedOut: z.literal(true) }),
      );
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 401)) throw error;
    }
    await client.cancelQueries();
    client.clear();
    router.replace('/login');
    router.refresh();
  }
  async function refresh() {
    await apiPost('/auth/refresh', z.object({ rotated: z.literal(true) }));
    await query.refetch();
  }
  return (
    <AuthContext.Provider
      value={{
        user: query.isError ? null : (query.data?.user ?? null),
        destination: query.isError ? undefined : query.data?.destination,
        loading: query.isPending || query.isFetching,
        error: query.error,
        login: () =>
          window.location.assign(
            env.NEXT_PUBLIC_API_BASE_URL.replace(/\/$/, '') + '/auth/google',
          ),
        logout,
        refresh,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('AuthProvider is required');
  return value;
}
export const useCurrentUser = useAuth;

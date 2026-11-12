import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from '@/features/auth/provider';
import { RouteGuard } from '@/features/auth/route-guard';
import { LoginEntry } from '@/features/auth/login-entry';
import { apiPost } from '@/lib/api/client';
import { z } from 'zod';
const mocks = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => mocks,
  useSearchParams: () => new URLSearchParams(),
}));
const user = {
  id: 'user',
  email: 'student@example.test',
  emailVerified: true,
  displayName: 'Test Student',
  role: 'STUDENT',
  accountStatus: 'ACTIVE',
  registrationStatus: 'VERIFIED',
};
function wrap(node: React.ReactNode) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false, gcTime: 0 } },
        })
      }
    >
      <AuthProvider>{node}</AuthProvider>
    </QueryClientProvider>,
  );
}
beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());
describe('authentication UI', () => {
  it('does not flash protected content while the session is loading', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {})),
    );
    wrap(
      <RouteGuard role="ADMIN">
        <div>Protected payload</div>
      </RouteGuard>,
    );
    expect(screen.queryByText('Protected payload')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Verifying');
  });
  it('blocks client rendering after backend session expiry', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            success: false,
            error: { code: 'SESSION_EXPIRED', message: 'Expired' },
          }),
          { status: 401 },
        ),
      ),
    );
    wrap(
      <RouteGuard role="STUDENT">
        <div>Protected payload</div>
      </RouteGuard>,
    );
    await waitFor(() =>
      expect(mocks.replace).toHaveBeenCalledWith(
        '/login?reason=session-expired',
      ),
    );
    expect(screen.queryByText('Protected payload')).not.toBeInTheDocument();
  });
  it('uses the verified backend role rather than an assumed role', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            success: true,
            data: { user, destination: '/student' },
          }),
        ),
      ),
    );
    wrap(
      <RouteGuard role="ADMIN">
        <div>Admin payload</div>
      </RouteGuard>,
    );
    await waitFor(() =>
      expect(mocks.replace).toHaveBeenCalledWith('/unauthorized'),
    );
    expect(screen.queryByText('Admin payload')).not.toBeInTheDocument();
  });
  it('shows an honest unavailable login and keeps Google disabled', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (url: string) =>
          new Response(
            JSON.stringify(
              url.endsWith('/auth/status')
                ? {
                    success: true,
                    data: {
                      available: false,
                      message: 'Authentication configuration is required',
                    },
                  }
                : {
                    success: false,
                    error: { code: 'AUTH_REQUIRED', message: 'Sign in' },
                  },
            ),
            { status: url.endsWith('/auth/status') ? 200 : 401 },
          ),
      ),
    );
    wrap(<LoginEntry />);
    await screen.findByText('Authentication configuration is required');
    expect(
      screen.getByRole('button', { name: 'Continue with Google' }),
    ).toBeDisabled();
  });
  it('sends cookies and bootstrapped CSRF on mutations', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            data: { csrfToken: 'csrf-from-backend' },
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: true, data: { loggedOut: true } }),
        ),
      );
    vi.stubGlobal('fetch', fetch);
    await apiPost('/auth/logout', z.object({ loggedOut: z.boolean() }));
    expect(fetch.mock.calls[0][1]).toMatchObject({
      credentials: 'include',
      cache: 'no-store',
    });
    expect(fetch.mock.calls[1][1]).toMatchObject({
      method: 'POST',
      credentials: 'include',
      headers: { 'X-CSRF-Token': 'csrf-from-backend' },
    });
  });
  it('clears cached data and refreshes routing after logout', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (url: string) =>
          new Response(
            JSON.stringify({
              success: true,
              data: url.endsWith('/me')
                ? { user, destination: '/student' }
                : url.endsWith('/csrf')
                  ? { csrfToken: 'csrf-from-backend' }
                  : { loggedOut: true },
            }),
          ),
      ),
    );
    function Action() {
      const auth = useAuth();
      return <button onClick={() => void auth.logout()}>Logout</button>;
    }
    wrap(<Action />);
    fireEvent.click(screen.getByText('Logout'));
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/login'));
    expect(mocks.refresh).toHaveBeenCalled();
  });
});

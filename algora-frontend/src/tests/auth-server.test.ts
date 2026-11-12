import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error('REDIRECT:' + path);
  }),
}));
vi.mock('next/headers', () => ({ cookies: mocks.cookies }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
import { requireWorkspace, requireSession } from '@/features/auth/server';
const user = {
  id: 'safe-user',
  email: 'learner@example.test',
  emailVerified: true,
  displayName: 'Test Learner',
  role: 'STUDENT',
  accountStatus: 'ACTIVE',
  registrationStatus: 'VERIFIED',
};
beforeEach(() => {
  mocks.cookies.mockResolvedValue({ get: () => ({ value: 'a'.repeat(43) }) });
  mocks.redirect.mockClear();
});
afterEach(() => vi.unstubAllGlobals());
describe('authoritative server route protection', () => {
  it('redirects unauthenticated direct navigation before fetching or rendering data', async () => {
    mocks.cookies.mockResolvedValue({ get: () => undefined });
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(requireWorkspace('ADMIN')).rejects.toThrow('REDIRECT:/login');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('forwards only the session cookie and disables caching', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ success: true, data: { authorized: true, user } }),
        ),
      );
    vi.stubGlobal('fetch', fetch);
    expect((await requireWorkspace('STUDENT')).user.id).toBe('safe-user');
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:5000/api/v1/auth/access/student',
      expect.objectContaining({
        cache: 'no-store',
        redirect: 'error',
        headers: { Cookie: 'algora_session=' + 'a'.repeat(43) },
      }),
    );
  });
  it('checks the authoritative backend again on refresh and rejects expired sessions', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: true, data: { authorized: true, user } }),
        ),
      )
      .mockResolvedValueOnce(new Response('{}', { status: 401 }));
    vi.stubGlobal('fetch', fetch);
    await requireWorkspace('STUDENT');
    await expect(requireWorkspace('STUDENT')).rejects.toThrow(
      'REDIRECT:/login?reason=session-expired',
    );
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it.each([
    ['FORBIDDEN', '/unauthorized'],
    ['ACCOUNT_SUSPENDED', '/account-suspended'],
    ['REGISTRATION_REQUIRED', '/student/register'],
    ['ACCOUNT_PENDING', '/account-pending'],
  ])('routes backend %s safely', async (code, path) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ success: false, error: { code } }), {
          status: 403,
        }),
      ),
    );
    await expect(requireWorkspace('ADMIN')).rejects.toThrow('REDIRECT:' + path);
  });
  it('fails closed on database or network failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(Error('unreachable')));
    await expect(requireWorkspace('SUPER_ADMIN')).rejects.toThrow(
      'REDIRECT:/login?error=unavailable',
    );
  });
  it('rejects malformed backend profiles', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            success: true,
            data: { authorized: true, user: { role: 'OWNER' } },
          }),
        ),
      ),
    );
    await expect(requireWorkspace('ADMIN')).rejects.toThrow(
      'REDIRECT:/login?error=unavailable',
    );
  });
  it('accepts only fixed backend account destinations', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            success: true,
            data: { user, destination: 'https://evil.example' },
          }),
        ),
      ),
    );
    await expect(requireSession()).rejects.toThrow(
      'REDIRECT:/login?error=unavailable',
    );
  });
});

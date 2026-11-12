import { afterEach, describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from '@/proxy';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
const user = {
  id: 'user',
  email: 'learner@example.test',
  emailVerified: true,
  displayName: 'Fixture User',
  role: 'STUDENT',
  accountStatus: 'ACTIVE',
  registrationStatus: 'VERIFIED',
};
const request = (path: string) =>
  new NextRequest('http://localhost:3000' + path, {
    headers: { Cookie: 'algora_session=' + 'a'.repeat(43) },
  });
describe('pre-render HTTP access checks', () => {
  it.each([
    '/student',
    '/admin',
    '/super-admin',
    '/registration-required',
    '/account-pending',
  ])('redirects direct unauthenticated %s before rendering', async (path) => {
    const response = await proxy(
      new NextRequest('http://localhost:3000' + path),
    );
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'http://localhost:3000/login',
    );
  });
  it('allows access only after the Express authorization endpoint succeeds', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ success: true, data: { authorized: true, user } }),
        ),
      );
    vi.stubGlobal('fetch', fetch);
    const response = await proxy(request('/student'));
    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(fetch.mock.calls[0][0]).toBe(
      'http://localhost:5000/api/v1/auth/access/student',
    );
  });
  it('rechecks on every refresh and redirects revoked sessions', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: true, data: { authorized: true, user } }),
        ),
      )
      .mockResolvedValueOnce(new Response('{}', { status: 401 }));
    vi.stubGlobal('fetch', fetch);
    await proxy(request('/student'));
    const expired = await proxy(request('/student'));
    expect(expired.status).toBe(307);
    expect(expired.headers.get('location')).toContain(
      '/login?reason=session-expired',
    );
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('redirects suspended accounts without rendering profile data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            success: false,
            error: { code: 'ACCOUNT_SUSPENDED' },
          }),
          { status: 403 },
        ),
      ),
    );
    expect((await proxy(request('/admin'))).headers.get('location')).toBe(
      'http://localhost:3000/account-suspended',
    );
  });
  it('restricts account-state pages to the authoritative lifecycle destination', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            success: true,
            data: {
              user: {
                ...user,
                accountStatus: 'PENDING',
                registrationStatus: 'NOT_STARTED',
              },
              destination: '/registration-required',
            },
          }),
        ),
      ),
    );
    expect(
      (await proxy(request('/account-pending'))).headers.get('location'),
    ).toBe('http://localhost:3000/registration-required');
  });
});

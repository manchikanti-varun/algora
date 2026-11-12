import { afterEach, describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from '@/proxy';
const user = {
  id: 'user',
  email: 'learner@example.test',
  emailVerified: true,
  displayName: 'Fixture Learner',
  role: 'STUDENT',
  accountStatus: 'PENDING',
  registrationStatus: 'NOT_STARTED',
};
afterEach(() => vi.unstubAllGlobals());
describe('Phase 3 authoritative route policy', () => {
  it('sends unauthenticated admin request visitors through the existing Google login intent', async () => {
    const response = await proxy(
      new NextRequest('http://localhost:3000/request-admin-access'),
    );
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain(
      '/login?intent=admin-access',
    );
  });
  it('allows a verified incomplete student to request access', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            success: true,
            data: { user, destination: '/registration-required' },
          }),
        ),
      ),
    );
    const response = await proxy(
      new NextRequest('http://localhost:3000/request-admin-access', {
        headers: { Cookie: 'algora_session=' + 'a'.repeat(43) },
      }),
    );
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });
  it('protects direct Super Admin subpage navigation with the backend role check', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ success: false, error: { code: 'FORBIDDEN' } }),
          { status: 403 },
        ),
      );
    vi.stubGlobal('fetch', fetch);
    const response = await proxy(
      new NextRequest('http://localhost:3000/super-admin/approvals', {
        headers: {
          Cookie: 'algora_session=' + 'a'.repeat(43),
          'X-Role': 'SUPER_ADMIN',
        },
      }),
    );
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('/unauthorized');
    expect(fetch.mock.calls[0][0]).toContain('/auth/access/super-admin');
  });
});

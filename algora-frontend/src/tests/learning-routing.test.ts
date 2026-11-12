import { afterEach, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from '@/proxy';
const base = {
  id: 'a'.repeat(24),
  email: 'student@example.test',
  emailVerified: true,
  displayName: 'Alice Morgan',
  role: 'STUDENT',
  accountStatus: 'ACTIVE',
  registrationStatus: 'PENDING_VERIFICATION',
};
afterEach(() => vi.unstubAllGlobals());
it('allows registered pending Students own-course summaries through authoritative session checks', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            success: true,
            data: { user: base, destination: '/student/profile' },
          }),
        ),
    ),
  );
  for (const path of ['/student/courses', '/student/batches'])
    expect(
      (
        await proxy(
          new NextRequest('http://localhost:3000' + path, {
            headers: { Cookie: 'algora_session=' + 'a'.repeat(43) },
          }),
        )
      ).headers.get('x-middleware-next'),
    ).toBe('1');
  expect(
    vi.mocked(fetch).mock.calls.every(([u]) => String(u).endsWith('/auth/me')),
  ).toBe(true);
});
it.each([
  '/admin/courses',
  '/admin/batches',
  '/admin/batches/abc/enrollments',
  '/super-admin/courses',
  '/super-admin/batches',
  '/super-admin/reconciliation',
])('protects direct management route %s without a session', async (path) => {
  expect(
    (await proxy(new NextRequest('http://localhost:3000' + path))).headers.get(
      'location',
    ),
  ).toBe('http://localhost:3000/login');
});

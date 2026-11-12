import { afterEach, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from '@/proxy';
import { destinationFor } from '@/features/auth/contracts';
const user = {
  id: 'a'.repeat(24),
  email: 'learner@example.test',
  emailVerified: true,
  displayName: 'Alice Morgan',
  role: 'STUDENT' as const,
  accountStatus: 'ACTIVE' as const,
  registrationStatus: 'PENDING_VERIFICATION' as const,
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
function req(path: string) {
  return new NextRequest('http://localhost:3000' + path, {
    headers: { Cookie: 'algora_session=' + 'a'.repeat(43) },
  });
}
function session(data = user) {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            success: true,
            data: { user: data, destination: destinationFor(data) },
          }),
        ),
    ),
  );
}
it('allows pending students profile and QR routes through /auth/me, not verified workspace access', async () => {
  vi.stubEnv('NODE_ENV', 'test');
  session();
  for (const path of ['/student/profile', '/student/my-qr']) {
    const res = await proxy(req(path));
    expect(res.headers.get('x-middleware-next')).toBe('1');
  }
  expect(
    vi.mocked(fetch).mock.calls.every(([u]) => String(u).endsWith('/auth/me')),
  ).toBe(true);
});
it('redirects registered students away from registration without looping', async () => {
  session();
  const res = await proxy(req('/student/register'));
  expect(res.headers.get('location')).toBe(
    'http://localhost:3000/student/profile',
  );
});
it('sends unregistered students to registration and permits its page', async () => {
  session({ ...user, registrationStatus: 'NOT_STARTED' } as never);
  expect((await proxy(req('/student/my-qr'))).headers.get('location')).toBe(
    'http://localhost:3000/student/register',
  );
  expect(
    (await proxy(req('/student/register'))).headers.get('x-middleware-next'),
  ).toBe('1');
});
it('blocks wrong-role student profile navigation without forcing Admin registration', async () => {
  session({ ...user, role: 'ADMIN', username: 'ad-reviewer' } as never);
  expect((await proxy(req('/student/profile'))).headers.get('location')).toBe(
    'http://localhost:3000/admin',
  );
});
it('fails closed on unavailable authority and expired sessions', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}', { status: 503 })),
  );
  expect(
    (await proxy(req('/student/profile'))).headers.get('location'),
  ).toContain('error=unavailable');
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}', { status: 401 })),
  );
  expect(
    (await proxy(req('/student/my-qr'))).headers.get('location'),
  ).toContain('session-expired');
});

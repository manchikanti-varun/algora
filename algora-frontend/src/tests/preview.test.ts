import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from '@/proxy';

afterEach(() => vi.unstubAllEnvs());
describe('development preview boundary', () => {
  it('returns 404 in production even when previews are enabled', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('ENABLE_PREVIEW_ROUTES', 'true');
    expect(
      (await proxy(new NextRequest('http://localhost/preview/admin'))).status,
    ).toBe(404);
  });
  it('requires the explicit development switch', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('ENABLE_PREVIEW_ROUTES', 'false');
    expect(
      (await proxy(new NextRequest('http://localhost/preview/student'))).status,
    ).toBe(404);
  });
  it('allows known roles only in enabled development', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('ENABLE_PREVIEW_ROUTES', 'true');
    expect(
      (
        await proxy(new NextRequest('http://localhost/preview/student'))
      ).headers.get('x-middleware-next'),
    ).toBe('1');
    expect(
      (await proxy(new NextRequest('http://localhost/preview/unknown'))).status,
    ).toBe(404);
  });
});

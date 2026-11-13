import { afterEach, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from '@/proxy';
afterEach(() => vi.unstubAllGlobals());
it.each([
  '/admin/attendance',
  '/super-admin/attendance',
  '/admin/batches/abc/attendance',
  '/super-admin/batches/abc/attendance',
  '/admin/batches/abc/attendance/session/scan',
  '/super-admin/batches/abc/attendance/session/scan',
  '/admin/batches/abc/attendance/reports',
  '/student/batches/abc/attendance',
  '/student/attendance',
])('protects attendance route %s without session', async (path) => {
  expect(
    (await proxy(new NextRequest('http://localhost:3000' + path))).headers.get(
      'location',
    ),
  ).toBe('http://localhost:3000/login');
});

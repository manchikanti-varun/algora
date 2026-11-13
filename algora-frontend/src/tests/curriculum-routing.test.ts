import { afterEach, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from '@/proxy';
afterEach(() => vi.unstubAllGlobals());
it.each([
  '/admin/problems',
  '/super-admin/problems',
  '/admin/courses/abc/curriculum',
  '/super-admin/courses/abc/curriculum',
  '/admin/batches/abc/curriculum',
  '/student/courses/abc',
  '/student/batches/abc',
  '/student/batches/abc/days/100',
])('protects curriculum route %s without session', async (path) => {
  expect(
    (await proxy(new NextRequest('http://localhost:3000' + path))).headers.get(
      'location',
    ),
  ).toBe('http://localhost:3000/login');
});

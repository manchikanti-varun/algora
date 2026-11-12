import type { NextConfig } from 'next';
import { z } from 'zod';
const backend = z
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  })
  .parse(
    process.env.BACKEND_API_BASE_URL ??
      (process.env.NODE_ENV === 'production'
        ? undefined
        : 'http://localhost:5000/api/v1'),
  )
  .replace(/\/$/, '');
if (
  process.env.NODE_ENV === 'production' &&
  !backend.startsWith('https://') &&
  new URL(backend).hostname !== 'localhost'
)
  throw new Error('Production backend must use HTTPS');
const config: NextConfig = {
  poweredByHeader: false,
  async rewrites() {
    return [{ source: '/backend/:path*', destination: backend + '/:path*' }];
  },
};
export default config;

import { describe, it, expect, vi } from 'vitest';
vi.mock('../config/env.js', () => ({
  env: {
    NODE_ENV: 'production',
    FRONTEND_URL: 'https://app.example.test',
    LOG_LEVEL: 'silent',
  },
}));
import {
  cookieOptions,
  sessionCookie,
  oauthCookie,
} from '../auth/middleware.js';
describe('production cookie policy', () => {
  it('uses host-only secure HTTP-only Lax cookies with root scope', () => {
    expect(cookieOptions).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
    });
    expect(cookieOptions).not.toHaveProperty('domain');
    expect(sessionCookie).toBe('__Host-algora_session');
    expect(oauthCookie).toBe('__Host-algora_oauth');
  });
});

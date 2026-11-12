import { beforeEach, describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { TestRepository, identity } from './auth-fixtures.js';
import {
  SessionService,
  hashToken,
  randomToken,
  csrfFor,
} from '../auth/session-service.js';
import type { GoogleProvider, OAuthChecks } from '../auth/google.js';
import { AppError } from '../middleware/errors.js';
import type { UserRecord } from '../auth/types.js';
import { destination } from '../auth/types.js';
import {
  normalizeName,
  isValidUsername,
  assertPermanentUsername,
} from '../utils/usernames.js';
import {
  transitionAccount,
  assertRegistrationTransition,
} from '../auth/lifecycle.js';
let repo: TestRepository;
let google: GoogleProvider;
let checks: OAuthChecks;
beforeEach(() => {
  repo = new TestRepository();
  google = {
    configured: () => true,
    authorize: vi.fn(async (c) => {
      checks = c;
      return 'https://accounts.google.com/o/oauth2/v2/auth?state=' + c.state;
    }),
    verify: vi.fn(async () => identity),
  };
});
const app = () => createApp(async () => true, { repository: repo, google });
async function begin(server = app()) {
  const started = await request(server).get('/api/v1/auth/google');
  const cookies = started.headers['set-cookie'] as unknown as string[];
  return {
    server,
    cookie: cookies[0]!.split(';')[0]!,
    state: new URL(started.headers.location).searchParams.get('state')!,
  };
}
async function seed(overrides: Partial<UserRecord> = {}) {
  const user = await repo.upsertGoogle(identity);
  Object.assign(
    user,
    { accountStatus: 'ACTIVE', registrationStatus: 'VERIFIED' },
    overrides,
  );
  const service = new SessionService(repo, 3600);
  const session = await service.create(user);
  return {
    user,
    service,
    ...session,
    cookie: 'algora_session=' + session.token,
  };
}
describe('OAuth HTTP boundary', () => {
  it('preserves an allowlisted admin-request intent through the backend transaction', async () => {
    const server = app();
    const started = await request(server).get(
      '/api/v1/auth/google?intent=admin-access',
    );
    const state = new URL(started.headers.location).searchParams.get('state')!;
    const cookie = (
      started.headers['set-cookie'] as unknown as string[]
    )[0]!.split(';')[0]!;
    const result = await request(server)
      .get('/api/v1/auth/google/callback')
      .query({ state, code: 'controlled-code' })
      .set('Cookie', cookie);
    expect(result.status).toBe(303);
    expect(result.headers.location).toBe(
      'http://localhost:3000/request-admin-access',
    );
  });
  it('rejects arbitrary login intents and does not trust callback redirect hints', async () => {
    expect(
      (
        await request(app()).get(
          '/api/v1/auth/google?intent=https://evil.example',
        )
      ).status,
    ).toBe(400);
    const flow = await begin();
    const result = await request(flow.server)
      .get('/api/v1/auth/google/callback')
      .query({
        state: flow.state,
        code: 'controlled-code',
        intent: 'admin-access',
        redirect: 'https://evil.example',
      })
      .set('Cookie', flow.cookie);
    expect(result.headers.location).toBe(
      'http://localhost:3000/registration-required',
    );
  });
  it('completes callback with a minimum-privilege account and secure HTTP-only cookie', async () => {
    const flow = await begin();
    const response = await request(flow.server)
      .get('/api/v1/auth/google/callback')
      .query({ code: 'controlled-code', state: flow.state })
      .set('Cookie', flow.cookie);
    expect(response.status).toBe(303);
    expect(response.headers.location).toBe(
      'http://localhost:3000/registration-required',
    );
    expect(response.headers['set-cookie'].join(';')).toContain('HttpOnly');
    expect(response.headers['set-cookie'].join(';')).toContain('SameSite=Lax');
    const user = [...repo.users.values()][0]!;
    expect(user.role).toBe('STUDENT');
    expect(user.accountStatus).toBe('PENDING');
    expect(user.username).toBeUndefined();
    expect(google.verify).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({
        state: flow.state,
        verifier: checks.verifier,
        nonce: checks.nonce,
      }),
    );
  });
  it('rejects invalid state without exchanging a code', async () => {
    const flow = await begin();
    const response = await request(flow.server)
      .get('/api/v1/auth/google/callback')
      .query({ state: randomToken(), code: 'code' })
      .set('Cookie', flow.cookie);
    expect(response.status).toBe(400);
    expect(google.verify).not.toHaveBeenCalled();
  });
  it('binds state to the initiating browser', async () => {
    const flow = await begin();
    expect(
      (
        await request(flow.server)
          .get('/api/v1/auth/google/callback')
          .query({ state: flow.state, code: 'code' })
          .set('Cookie', 'algora_oauth=' + randomToken())
      ).status,
    ).toBe(400);
  });
  it('rejects missing PKCE verifier', async () => {
    const flow = await begin();
    repo.transactions.get(hashToken(flow.state))!.verifier = '';
    const response = await request(flow.server)
      .get('/api/v1/auth/google/callback')
      .query({ state: flow.state, code: 'code' })
      .set('Cookie', flow.cookie);
    expect(response.status).toBe(400);
    expect(google.verify).not.toHaveBeenCalled();
  });
  it('rejects invalid ID tokens', async () => {
    google.verify = vi.fn(async () => {
      throw new AppError(
        401,
        'OAUTH_FAILED',
        'Google sign-in could not be verified',
      );
    });
    const flow = await begin();
    expect(
      (
        await request(flow.server)
          .get('/api/v1/auth/google/callback')
          .query({ state: flow.state, code: 'bad-token-code' })
          .set('Cookie', flow.cookie)
      ).status,
    ).toBe(401);
    expect(repo.sessions.size).toBe(0);
  });
  it('rejects unverified email', async () => {
    google.verify = vi.fn(async () => ({ ...identity, emailVerified: false }));
    const flow = await begin();
    const response = await request(flow.server)
      .get('/api/v1/auth/google/callback')
      .query({ state: flow.state, code: 'code' })
      .set('Cookie', flow.cookie);
    expect(response.status).toBe(401);
    expect(repo.users.size).toBe(0);
  });
  it('consumes callback state exactly once', async () => {
    const flow = await begin();
    const url =
      '/api/v1/auth/google/callback?state=' + flow.state + '&code=code';
    expect(
      (await request(flow.server).get(url).set('Cookie', flow.cookie)).status,
    ).toBe(303);
    expect(
      (await request(flow.server).get(url).set('Cookie', flow.cookie)).status,
    ).toBe(400);
  });
  it('rejects expired OAuth transactions', async () => {
    const flow = await begin();
    repo.transactions.get(hashToken(flow.state))!.expiresAt = new Date(0);
    expect(
      (
        await request(flow.server)
          .get('/api/v1/auth/google/callback')
          .query({ state: flow.state, code: 'code' })
          .set('Cookie', flow.cookie)
      ).status,
    ).toBe(400);
  });
  it('handles concurrent first-login callbacks without duplicate users', async () => {
    const server = app();
    const flows = await Promise.all(
      Array.from({ length: 8 }, () => begin(server)),
    );
    const results = await Promise.all(
      flows.map((flow) =>
        request(server)
          .get('/api/v1/auth/google/callback')
          .query({ state: flow.state, code: 'code' })
          .set('Cookie', flow.cookie),
      ),
    );
    expect(results.every((r) => r.status === 303)).toBe(true);
    expect(repo.users.size).toBe(1);
  });
  it('does not accept browser-supplied redirects or role overrides', async () => {
    expect(
      (
        await request(app()).get(
          '/api/v1/auth/google?returnTo=https://evil.test&role=SUPER_ADMIN',
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app())
          .post('/api/v1/auth/role')
          .send({ role: 'SUPER_ADMIN' })
      ).status,
    ).toBe(404);
  });
  it('fails safely when database is unavailable', async () => {
    repo.available = false;
    const response = await request(app()).get('/api/v1/auth/google');
    expect(response.status).toBe(503);
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(repo.sessions.size).toBe(0);
  });
  it('reports missing configuration honestly', async () => {
    google.configured = () => false;
    const response = await request(app()).get('/api/v1/auth/status');
    expect(response.body.data.available).toBe(false);
    expect((await request(app()).get('/api/v1/auth/google')).status).toBe(503);
  });
  it('handles user cancellation without creating sessions', async () => {
    const flow = await begin();
    expect(
      (
        await request(flow.server)
          .get('/api/v1/auth/google/callback')
          .query({ state: flow.state, error: 'access_denied' })
          .set('Cookie', flow.cookie)
      ).status,
    ).toBe(401);
    expect(repo.sessions.size).toBe(0);
  });
});
describe('session and authorization HTTP contracts', () => {
  it('rejects missing authentication', async () => {
    expect((await request(app()).get('/api/v1/auth/me')).status).toBe(401);
  });
  it('returns only the public profile', async () => {
    const seedData = await seed();
    const r = await request(app())
      .get('/api/v1/auth/me')
      .set('Cookie', seedData.cookie);
    expect(r.status).toBe(200);
    expect(r.body.data.user.email).toBe(identity.email);
    expect(JSON.stringify(r.body)).not.toContain('tokenHash');
    expect(JSON.stringify(r.body)).not.toContain('googleSubject');
    expect(r.headers['cache-control']).toContain('no-store');
  });
  it('rejects student access to admin', async () => {
    const data = await seed();
    expect(
      (
        await request(app())
          .get('/api/v1/auth/access/admin')
          .set('Cookie', data.cookie)
      ).status,
    ).toBe(403);
  });
  it('rejects admin access to super admin', async () => {
    const data = await seed({ role: 'ADMIN' });
    expect(
      (
        await request(app())
          .get('/api/v1/auth/access/super-admin')
          .set('Cookie', data.cookie)
      ).status,
    ).toBe(403);
  });
  it.each(['STUDENT', 'ADMIN', 'SUPER_ADMIN'] as const)(
    'allows only authorized active %s',
    async (role) => {
      const data = await seed({ role });
      const path = role === 'SUPER_ADMIN' ? 'super-admin' : role.toLowerCase();
      expect(
        (
          await request(app())
            .get('/api/v1/auth/access/' + path)
            .set('Cookie', data.cookie)
        ).status,
      ).toBe(200);
    },
  );
  it('blocks incomplete registration independently of active state', async () => {
    const data = await seed({ registrationStatus: 'INCOMPLETE' });
    const r = await request(app())
      .get('/api/v1/auth/access/student')
      .set('Cookie', data.cookie);
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('REGISTRATION_REQUIRED');
  });
  it('blocks pending account', async () => {
    const data = await seed({ role: 'ADMIN', accountStatus: 'PENDING' });
    expect(
      (
        await request(app())
          .get('/api/v1/auth/access/admin')
          .set('Cookie', data.cookie)
      ).body.error.code,
    ).toBe('ACCOUNT_PENDING');
  });
  it('revokes sessions after suspension', async () => {
    const data = await seed();
    data.user.accountStatus = 'SUSPENDED';
    const r = await request(app())
      .get('/api/v1/auth/me')
      .set('Cookie', data.cookie);
    expect(r.status).toBe(403);
    expect([...repo.sessions.values()].every((s) => s.revokedAt)).toBe(true);
  });
  it.each(['logout', 'logout-all', 'refresh'])(
    'rejects CSRF on %s',
    async (path) => {
      const data = await seed();
      expect(
        (
          await request(app())
            .post('/api/v1/auth/' + path)
            .set('Cookie', data.cookie)
            .set('Origin', 'http://localhost:3000')
        ).status,
      ).toBe(403);
    },
  );
  it('rejects absent origin even with a valid CSRF token', async () => {
    const data = await seed();
    expect(
      (
        await request(app())
          .post('/api/v1/auth/logout')
          .set('Cookie', data.cookie)
          .set('X-CSRF-Token', csrfFor(data.session.tokenHash))
      ).status,
    ).toBe(403);
  });
  it('rejects CSRF tokens from another session', async () => {
    const data = await seed();
    expect(
      (
        await request(app())
          .post('/api/v1/auth/logout')
          .set('Cookie', data.cookie)
          .set('Origin', 'http://localhost:3000')
          .set('X-CSRF-Token', csrfFor(hashToken(randomToken())))
      ).status,
    ).toBe(403);
  });
  it('logs out and clears cookie with correct CSRF', async () => {
    const data = await seed();
    const server = app();
    const csrf = await request(server)
      .get('/api/v1/auth/csrf')
      .set('Cookie', data.cookie);
    const r = await request(server)
      .post('/api/v1/auth/logout')
      .set('Cookie', data.cookie)
      .set('Origin', 'http://localhost:3000')
      .set('X-CSRF-Token', csrf.body.data.csrfToken);
    expect(r.status).toBe(200);
    expect(
      (await request(server).get('/api/v1/auth/me').set('Cookie', data.cookie))
        .status,
    ).toBe(401);
    expect(r.headers['set-cookie'].join(';')).toContain(
      'Expires=Thu, 01 Jan 1970',
    );
  });
  it('revokes every device', async () => {
    const data = await seed();
    const second = await data.service.create(data.user);
    const r = await request(app())
      .post('/api/v1/auth/logout-all')
      .set('Cookie', data.cookie)
      .set('Origin', 'http://localhost:3000')
      .set('X-CSRF-Token', csrfFor(data.session.tokenHash));
    expect(r.status).toBe(200);
    await expect(data.service.authenticate(second.token)).rejects.toMatchObject(
      { status: 401 },
    );
  });
  it('atomically rotates sessions without accepting the old token', async () => {
    const data = await seed();
    const r = await request(app())
      .post('/api/v1/auth/refresh')
      .set('Cookie', data.cookie)
      .set('Origin', 'http://localhost:3000')
      .set('X-CSRF-Token', csrfFor(data.session.tokenHash));
    expect(r.status).toBe(200);
    await expect(data.service.authenticate(data.token)).rejects.toMatchObject({
      status: 401,
    });
  });
  it('returns sanitized database failures for stored-session lookups', async () => {
    const data = await seed();
    repo.available = false;
    const r = await request(app())
      .get('/api/v1/auth/me')
      .set('Cookie', data.cookie);
    expect(r.status).toBe(503);
    expect(r.body.error.code).toBe('AUTH_UNAVAILABLE');
  });
});
describe('session, naming and lifecycle utilities', () => {
  it('never creates a session when storage is unavailable', async () => {
    const user = await repo.upsertGoogle(identity);
    repo.available = false;
    await expect(
      new SessionService(repo, 3600).create(user),
    ).rejects.toMatchObject({ status: 503 });
    expect(repo.sessions.size).toBe(0);
  });
  it('stores a hash instead of the raw session token', async () => {
    const data = await seed();
    expect(data.session.tokenHash).toBe(hashToken(data.token));
    expect(data.session.tokenHash).not.toBe(data.token);
  });
  it('checks expiry before database TTL cleanup', async () => {
    const data = await seed();
    data.session.expiresAt = new Date(0);
    await expect(data.service.authenticate(data.token)).rejects.toMatchObject({
      code: 'SESSION_EXPIRED',
    });
  });
  it('rejects revoked sessions', async () => {
    const data = await seed();
    await data.service.logout({ user: data.user, session: data.session });
    await expect(data.service.authenticate(data.token)).rejects.toMatchObject({
      status: 401,
    });
  });
  it('checks the current user revocation version', async () => {
    const data = await seed();
    data.user.sessionVersion++;
    await expect(data.service.authenticate(data.token)).rejects.toMatchObject({
      status: 401,
    });
  });
  it('normalizes names without allocating usernames', () => {
    expect(normalizeName('  Álìce  Lee! ')).toBe('alice-lee');
    expect(isValidUsername('sa-alicelee', 'SUPER_ADMIN')).toBe(true);
    expect(isValidUsername('ad-alicelee', 'ADMIN')).toBe(true);
    expect(isValidUsername('23cs101-alice-lee', 'STUDENT')).toBe(true);
    expect(isValidUsername('ADMIN-Alice', 'ADMIN')).toBe(false);
    expect(() => assertPermanentUsername('sa-one', 'sa-two')).toThrow();
  });
  it('validates lifecycle transitions and revokes on suspension', async () => {
    const data = await seed();
    await transitionAccount(repo, data.user.id, 'ACTIVE', 'SUSPENDED');
    expect(data.user.accountStatus).toBe('SUSPENDED');
    expect(data.session.revokedAt).not.toBeNull();
    expect(() =>
      assertRegistrationTransition('NOT_STARTED', 'VERIFIED'),
    ).toThrow();
    await expect(
      transitionAccount(repo, data.user.id, 'ARCHIVED', 'ACTIVE'),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
  });
  it('orders registration and account destinations correctly', async () => {
    const data = await seed();
    expect(
      destination({
        ...data.user,
        accountStatus: 'PENDING',
        registrationStatus: 'NOT_STARTED',
      }),
    ).toBe('/registration-required');
    expect(
      destination({
        ...data.user,
        accountStatus: 'PENDING',
        registrationStatus: 'PENDING_VERIFICATION',
      }),
    ).toBe('/account-pending');
    expect(destination({ ...data.user, accountStatus: 'SUSPENDED' })).toBe(
      '/account-suspended',
    );
  });
});

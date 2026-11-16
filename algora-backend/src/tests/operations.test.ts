import { it, expect, beforeEach, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import request from 'supertest';
import { configurationChecks } from '../operations/checks.js';
import {
  compatibleIndex,
  startupRetryDelay,
  permanentDatabaseFailure,
  validateTransactions,
  inspectDatabase,
  ensureApplicationCollections,
} from '../operations/database.js';
import { applicationModels } from '../operations/models.js';
import type { Connection } from 'mongoose';
import { finalizedRates } from '../attendance/metrics.js';
import { setupAnalytics } from './analytics-fixtures.js';
import { AnalyticsService } from '../analytics/service.js';
import { createApp } from '../app.js';
import { SessionService, csrfFor } from '../auth/session-service.js';
import { identity } from './auth-fixtures.js';
const configured = () => ({
  NODE_ENV: 'production',
  FRONTEND_URL: 'https://app.example.com',
  BACKEND_API_BASE_URL: 'https://api.example.com/api/v1',
  NEXT_PUBLIC_API_BASE_URL: '/backend',
  CORS_ORIGINS: 'https://app.example.com',
  TRUST_PROXY_HOPS: '1',
  GOOGLE_CLIENT_ID: 'fixture-client',
  GOOGLE_CLIENT_SECRET: randomBytes(32).toString('base64'),
  GOOGLE_REDIRECT_URI: 'https://app.example.com/backend/auth/google/callback',
  MONGODB_URI: 'mongodb+srv://cluster.example.com/algora_acceptance',
  QR_ACTIVE_KEY_ID: 'fixture',
  QR_ENCRYPTION_KEYS: JSON.stringify({
    fixture: randomBytes(32).toString('base64'),
  }),
  CODEFORCES_CLIENT_ID: 'fixture-codeforces',
  CODEFORCES_CLIENT_SECRET: randomBytes(32).toString('base64'),
  CODEFORCES_REDIRECT_URI:
    'https://app.example.com/backend/coding/accounts/codeforces/callback',
  CODING_SYNC_ENABLED: 'true',
});
it('passes sanitized production configuration checks without emitting any values', () => {
  const raw = configured(),
    checks = configurationChecks(raw, '24.0.0');
  expect(checks.every((c) => c.status === 'PASS')).toBe(true);
  expect(JSON.stringify(checks)).not.toContain(raw.GOOGLE_CLIENT_SECRET);
  expect(JSON.stringify(checks)).not.toContain(raw.MONGODB_URI);
});
it.each(['21.9.0', '27.0.0'])('rejects unsupported Node %s', (version) =>
  expect(configurationChecks(configured(), version)[0]!.status).toBe('FAIL'),
);
it.each([
  'GOOGLE_CLIENT_SECRET',
  'MONGODB_URI',
  'QR_ENCRYPTION_KEYS',
  'CODEFORCES_CLIENT_ID',
])('reports missing %s without a secret dump', (key) => {
  const raw: Record<string, string | undefined> = configured();
  delete raw[key];
  const checks = configurationChecks(raw);
  expect(
    checks.some((c) => ['NOT CONFIGURED', 'BLOCKED'].includes(c.status)),
  ).toBe(true);
  expect(JSON.stringify(checks)).not.toContain(
    raw.GOOGLE_CLIENT_SECRET ?? 'not-a-value',
  );
});
it.each([
  { FRONTEND_URL: 'http://app.example.com' },
  { BACKEND_API_BASE_URL: 'https://api.example.com' },
  { CORS_ORIGINS: '*' },
  { TRUST_PROXY_HOPS: '2' },
  { APP_REPLICAS: '2' },
  {
    GOOGLE_REDIRECT_URI: 'https://api.example.com/api/v1/auth/google/callback',
  },
  { NEXT_PUBLIC_API_BASE_URL: 'https://api.example.com/api/v1' },
  { QR_ENCRYPTION_KEYS: '{}' },
  { ENABLE_PREVIEW_ROUTES: 'true' },
  { API_RATE_LIMIT: '120' },
  { LOGIN_RATE_LIMIT: '20' },
])('detects unsafe production settings %j', (change) =>
  expect(
    configurationChecks({ ...configured(), ...change }).some(
      (c) => c.status !== 'PASS',
    ),
  ).toBe(true),
);
it('keeps both named attendance rates explicit for excused, missing and zero denominators', () => {
  expect(
    finalizedRates({ present: 3, absent: 1, excused: 1, unmarked: 1 }),
  ).toMatchObject({
    eligible: 6,
    attendanceRate: 0.5,
    participationRate: 0.75,
  });
  expect(
    finalizedRates({ present: 0, absent: 0, excused: 0, unmarked: 0 }),
  ).toMatchObject({ attendanceRate: null, participationRate: null });
});
it('compares compound index order, uniqueness, TTL, sparse and partial options', () => {
  const expected = {
    key: { collegeId: 1, roll: 1 },
    unique: true,
    partialFilterExpression: { status: 'ACTIVE' },
  };
  expect(compatibleIndex(expected, { ...expected })).toBe(true);
  expect(
    compatibleIndex(expected, { ...expected, key: { roll: 1, collegeId: 1 } }),
  ).toBe(false);
  expect(compatibleIndex(expected, { ...expected, unique: false })).toBe(false);
  expect(compatibleIndex(expected, { ...expected, sparse: true })).toBe(false);
  expect(
    compatibleIndex(expected, { ...expected, expireAfterSeconds: 0 }),
  ).toBe(false);
  expect(
    compatibleIndex(expected, {
      ...expected,
      partialFilterExpression: { status: 'REVOKED' },
    }),
  ).toBe(false);
});
it('uses bounded startup backoff and distinguishes permanent index/auth conflicts', () => {
  expect([0, 1, 10].map(startupRetryDelay)).toEqual([1000, 2000, 30000]);
  for (const code of [13, 18, 20, 85, 86, 11000])
    expect(permanentDatabaseFailure({ code })).toBe(true);
  expect(permanentDatabaseFailure({ code: 91 })).toBe(false);
});
it('commits a read-only snapshot transaction and always closes the session', async () => {
  const session = {
      startTransaction: vi.fn(),
      commitTransaction: vi.fn(),
      abortTransaction: vi.fn(),
      inTransaction: () => false,
      endSession: vi.fn(),
    },
    find = vi.fn(async () => null);
  const connection = {
    startSession: async () => session,
    db: { collection: () => ({ findOne: find }) },
  } as unknown as Connection;
  await validateTransactions(connection);
  expect(session.startTransaction).toHaveBeenCalledWith(
    expect.objectContaining({ readConcern: { level: 'snapshot' } }),
  );
  expect(find).toHaveBeenCalledWith(
    {},
    expect.objectContaining({ session, projection: { _id: 1 } }),
  );
  expect(session.commitTransaction).toHaveBeenCalledOnce();
  expect(session.endSession).toHaveBeenCalledOnce();
});
it('aborts failed transaction checks without printing database errors', async () => {
  const secret = 'fixture-sensitive-connection-detail',
    session = {
      startTransaction: vi.fn(),
      commitTransaction: vi.fn(),
      abortTransaction: vi.fn(),
      inTransaction: () => true,
      endSession: vi.fn(),
    };
  const connection = {
    startSession: async () => session,
    db: {
      collection: () => ({
        findOne: async () => {
          throw new Error(secret);
        },
      }),
    },
  } as unknown as Connection;
  await expect(validateTransactions(connection)).rejects.toThrow(secret);
  expect(session.abortTransaction).toHaveBeenCalledOnce();
  expect(session.endSession).toHaveBeenCalledOnce();
});
it('sanitizes unavailable database status', async () => {
  const c = {
    db: {
      admin: () => ({
        ping: async () => {
          throw new Error('fixture-private-network-data');
        },
      }),
    },
  } as unknown as Connection;
  const checks = await inspectDatabase(c);
  expect(checks[0]!.status).toBe('BLOCKED');
  expect(JSON.stringify(checks)).not.toContain('fixture-private-network-data');
});
it.each([
  [26, 'FAIL'],
  [91, 'BLOCKED'],
] as const)(
  'distinguishes missing indexes from transient metadata error %s',
  async (code, status) => {
    const c = {
      startSession: async () => ({
        startTransaction() {},
        async commitTransaction() {},
        inTransaction: () => false,
        async endSession() {},
      }),
      db: {
        admin: () => ({ async ping() {} }),
        collection: () => ({
          async findOne() {
            return null;
          },
          listIndexes: () => ({
            async toArray() {
              throw Object.assign(new Error('fixture-sensitive'), { code });
            },
          }),
        }),
      },
    } as unknown as Connection;
    const checks = await inspectDatabase(c);
    expect(
      checks.find((c) => c.check === 'Required schema indexes')!.status,
    ).toBe(status);
    expect(JSON.stringify(checks)).not.toContain('fixture-sensitive');
  },
);
it('does not recreate existing application collections or delete records', async () => {
  const create = vi.fn();
  await ensureApplicationCollections({
    db: {
      listCollections: () => ({ hasNext: async () => true }),
      createCollection: create,
    },
  } as unknown as Connection);
  expect(applicationModels.length).toBeGreaterThan(15);
  expect(create).not.toHaveBeenCalled();
});
it('can run preflight with missing configuration without importing runtime env validation or logging secrets', async () => {
  const env = { ...process.env };
  for (const k of [
    'MONGODB_URI',
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'GOOGLE_REDIRECT_URI',
  ])
    delete env[k];
  const result = await promisify(execFile)(
    process.execPath,
    ['node_modules/tsx/dist/cli.mjs', 'src/scripts/preflight.ts'],
    { env, timeout: 45000 },
  ).catch((e) => e as { stdout: string; stderr: string; code: number });
  expect(result.stdout).toContain('NOT CONFIGURED');
  expect(result.stdout).toContain('"productionAccepted": false');
  expect(result.stderr).not.toContain('Invalid backend environment');
}, 60000);
let f: Awaited<ReturnType<typeof setupAnalytics>>;
beforeEach(async () => {
  f = await setupAnalytics();
});
it('shows real Batch blockers and does not claim camera acceptance', async () => {
  const ready = await f.analytics.readiness(f.owner.id, f.batch, {});
  expect(
    ready.checks.find((c) => c.check === 'Pinned curriculum')!.status,
  ).toBe('PASS');
  expect(ready.sessions).toHaveLength(2);
  expect(ready.sessions.every((s) => s.camera === 'NOT TESTED')).toBe(true);
  expect(ready.codingReady).toBe(false);
});
it('enforces current combined College authority on readiness and self-only restrictions', async () => {
  await expect(
    f.analytics.readiness(f.student.user.id, f.batch, {}),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    f.analytics.readiness(f.admin.id, f.batch, {}),
  ).rejects.toMatchObject({ status: 403 });
});
it('returns separate readiness for an open session and truthful end-of-day unknown coding', async () => {
  await f.session();
  const service = new AnalyticsService(
      f.service,
      f.learning,
      f.repo,
      f.source,
      f.getNow,
      { qr: () => true, coding: () => true, worker: () => true },
    ),
    ready = await service.readiness(f.owner.id, f.batch, {});
  expect(ready.sessions.find((s) => s.type === 'MORNING')!.scanReady).toBe(
    true,
  );
  expect(ready.sessions.find((s) => s.type === 'AFTERNOON')!.status).toBe(
    'NOT CREATED',
  );
  expect(ready.days[0]!.coding.unavailable).toBe(1);
  expect(ready.days[0]!.finalizedSessions).toBe(0);
});
it('retries only current failed jobs and preserves active-job backoff', async () => {
  const a = await f.link();
  await f.verify(a.id);
  const j = await f.queue();
  await expect(
    f.service.retry(
      f.student.user.id,
      f.batch,
      j.id,
      { confirmed: true },
      'test',
    ),
  ).rejects.toMatchObject({ code: 'SYNC_RETRY_NOT_DUE' });
  const row = f.repo.jobs.get(j.id)!;
  row.status = 'FAILED';
  row.active = false;
  row.nextAt = f.getNow().toISOString();
  await expect(
    f.service.retry(
      f.student.user.id,
      f.batch,
      j.id,
      { confirmed: true },
      'test',
    ),
  ).rejects.toMatchObject({ code: 'SYNC_COOLDOWN' });
  f.advance(61000);
  const result = await f.service.retry(
    f.student.user.id,
    f.batch,
    j.id,
    { confirmed: true },
    'test',
  );
  expect(result.status).toBe('QUEUED');
  expect([...f.repo.jobs.values()].filter((j) => j.active)).toHaveLength(1);
});
it('blocks future retry windows on both retry and generic refresh', async () => {
  const a = await f.link();
  await f.verify(a.id);
  const j = await f.queue(),
    row = f.repo.jobs.get(j.id)!;
  row.status = 'FAILED';
  row.active = false;
  row.nextAt = new Date(f.getNow().getTime() + 60000).toISOString();
  await expect(
    f.service.retry(
      f.student.user.id,
      f.batch,
      j.id,
      { confirmed: true },
      'test',
    ),
  ).rejects.toMatchObject({ status: 429 });
  await expect(f.queue()).rejects.toMatchObject({ status: 429 });
});
it('denies another Student retry and rejects stale account revisions', async () => {
  const a = await f.link();
  await f.verify(a.id);
  const j = await f.queue(),
    other = await f.addStudent();
  await expect(
    f.service.retry(other.user.id, f.batch, j.id, { confirmed: true }, 'test'),
  ).rejects.toMatchObject({ status: 403 });
  const row = f.repo.jobs.get(j.id)!;
  row.status = 'FAILED';
  row.active = false;
  row.accountRevision--;
  await expect(
    f.service.retry(
      f.student.user.id,
      f.batch,
      j.id,
      { confirmed: true },
      'test',
    ),
  ).rejects.toMatchObject({ code: 'SYNC_CONTEXT_CHANGED' });
});
function app() {
  const l = f.repo.curriculum.learning;
  return createApp(
    async () => true,
    {
      repository: l.students.admin.auth,
      google: {
        configured: () => false,
        authorize: async () => '',
        verify: async () => identity,
      },
    },
    l.students.admin,
    l.students,
    l,
    f.repo.curriculum,
    f.attendanceRepo,
    f.repo,
    f.source,
  );
}
it('returns contract headers and private readiness over real HTTP without auth bypasses', async () => {
  const application = app();
  expect(
    (await request(application).get('/api/v1/health')).headers[
      'x-algora-api-version'
    ],
  ).toBe('1');
  const denied = await request(application)
    .get('/api/v1/analytics/batches/' + f.batch + '/readiness')
    .set('X-Role', 'SUPER_ADMIN');
  expect(denied.status).toBe(401);
  const s = await new SessionService(
    f.repo.curriculum.learning.students.admin.auth,
    3600,
  ).create(f.owner);
  const result = await request(application)
    .get('/api/v1/analytics/batches/' + f.batch + '/readiness')
    .set('Cookie', 'algora_session=' + s.token);
  expect(result.status).toBe(200);
  expect(result.headers['cache-control']).toContain('no-store');
});
it('requires Origin and CSRF on retry and rejects unsupported body fields', async () => {
  const a = await f.link();
  await f.verify(a.id);
  const j = await f.queue(),
    s = await new SessionService(
      f.repo.curriculum.learning.students.admin.auth,
      3600,
    ).create(f.student.user);
  const path =
    '/api/v1/batches/' + f.batch + '/progress/jobs/' + j.id + '/retry';
  expect(
    (
      await request(app())
        .post(path)
        .set('Cookie', 'algora_session=' + s.token)
        .send({ confirmed: true })
    ).status,
  ).toBe(403);
  expect(
    (
      await request(app())
        .post(path)
        .set({
          Cookie: 'algora_session=' + s.token,
          Origin: 'http://localhost:3000',
          'X-CSRF-Token': csrfFor(s.session.tokenHash),
        })
        .send({ confirmed: true, role: 'SUPER_ADMIN' })
    ).status,
  ).toBe(400);
});
it('rejects incompatible client contracts before mutations', async () => {
  const result = await request(app())
    .post('/api/v1/coding/accounts')
    .set('X-Algora-API-Version', '2')
    .send({ confirmed: true });
  expect(result.status).toBe(409);
  expect(result.body.error.code).toBe('API_VERSION_MISMATCH');
  expect(f.repo.accounts.size).toBe(0);
});
it('preserves verified solves when a failed job is recovered', async () => {
  const account = await f.link();
  await f.verify(account.id);
  const job = await f.queue();
  await f.service.processOne();
  expect(
    (await f.service.dashboard(f.student.user.id, f.batch, {})).summary.solved,
  ).toBe(1);
  const row = f.repo.jobs.get(job.id)!;
  row.status = 'FAILED';
  row.active = false;
  f.advance(61000);
  await f.service.retry(
    f.student.user.id,
    f.batch,
    job.id,
    { confirmed: true },
    'test',
  );
  f.setResponse({ status: 'OK', result: [] });
  await f.service.processOne();
  expect(
    (await f.service.dashboard(f.student.user.id, f.batch, {})).summary.solved,
  ).toBe(1);
});
it('uses production host-only secure cookie configuration without exposing configuration values', async () => {
  const env = { ...process.env, ...configured() };
  const code =
    "import('./src/auth/middleware.ts').then(m=>console.log(JSON.stringify({name:m.sessionCookie,...m.cookieOptions})))";
  const result = await promisify(execFile)(
    process.execPath,
    ['node_modules/tsx/dist/cli.mjs', '-e', code],
    { env, timeout: 45000 },
  );
  const value = JSON.parse(result.stdout.trim().split('\n').at(-1)!);
  expect(value).toMatchObject({
    name: '__Host-algora_session',
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
  });
  expect(value).not.toHaveProperty('domain');
}, 60000);

import ExcelJS from 'exceljs';
import { beforeEach, it, expect } from 'vitest';
import request from 'supertest';
import { setupCoding } from './coding-fixtures.js';
import { createApp } from '../app.js';
import { SessionService, csrfFor } from '../auth/session-service.js';
import { identity } from './auth-fixtures.js';
let f: Awaited<ReturnType<typeof setupCoding>>;
beforeEach(async () => {
  f = await setupCoding();
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
    undefined,
    f.repo,
  );
}
async function headers(user = f.student.user) {
  const c = await new SessionService(
    f.repo.curriculum.learning.students.admin.auth,
    3600,
  ).create(user);
  return {
    Cookie: 'algora_session=' + c.token,
    Origin: 'http://localhost:3000',
    'X-CSRF-Token': csrfFor(c.session.tokenHash),
  };
}
it.each([
  '/coding/accounts',
  '/coding/batches',
  '/students/me/progress/batches',
  '/batches/aaaaaaaaaaaaaaaaaaaaaaaa/progress',
])('requires real authentication and no-store on %s', async (path) => {
  const r = await request(app())
    .get('/api/v1' + path)
    .set('X-Role', 'SUPER_ADMIN');
  expect(r.status).toBe(401);
  expect(r.headers['cache-control']).toContain('no-store');
});
it('rejects mutations without CSRF/exact Origin', async () => {
  const h = await headers();
  const r = await request(app())
    .post('/api/v1/coding/accounts')
    .set({ Cookie: h.Cookie })
    .send({
      platform: 'CODEFORCES',
      handle: 'learner',
      expectedRevision: null,
      confirmed: true,
    });
  expect(r.status).toBe(403);
  expect(f.repo.accounts.size).toBe(0);
});
it('accepts sanitized account management and never trusts submitted verification fields', async () => {
  const h = await headers(),
    r = await request(app()).post('/api/v1/coding/accounts').set(h).send({
      platform: 'CODEFORCES',
      handle: 'learner',
      expectedRevision: null,
      confirmed: true,
    });
  expect(r.status).toBe(200);
  expect(r.body.data.status).toBe('VERIFICATION_UNAVAILABLE');
  const invalid = await request(app())
    .post('/api/v1/coding/accounts')
    .set(h)
    .send({
      platform: 'CODEFORCES',
      handle: 'learner',
      expectedRevision: 0,
      confirmed: true,
      status: 'VERIFIED',
    });
  expect(invalid.status).toBe(400);
});
it('rejects invalid IDs and unsupported query injection', async () => {
  const h = await headers();
  expect(
    (
      await request(app())
        .get('/api/v1/students/me/batches/not-an-id/progress')
        .set(h)
    ).status,
  ).toBe(400);
  expect(
    (
      await request(app())
        .get(
          '/api/v1/students/me/batches/' +
            f.batch +
            '/progress?role=SUPER_ADMIN',
        )
        .set(h)
    ).status,
  ).toBe(400);
});
it('protects staff reports and exports from Students', async () => {
  const h = await headers();
  expect(
    (
      await request(app())
        .get('/api/v1/batches/' + f.batch + '/progress')
        .set(h)
    ).status,
  ).toBe(403);
  expect(
    (
      await request(app())
        .post('/api/v1/batches/' + f.batch + '/progress/export')
        .set(h)
        .send({ format: 'CSV', filters: {}, confirmed: true })
    ).status,
  ).toBe(403);
});
it('does not expose another Student evidence through profile query parameters', async () => {
  const a = await f.link();
  await f.verify(a.id);
  await f.queue();
  await f.service.processOne();
  const assignment = [...f.repo.evidence.values()][0]!.assignmentId;
  const other = await f.addStudent();
  const r = await request(app())
    .get(
      '/api/v1/batches/' +
        f.batch +
        '/progress/assignments/' +
        assignment +
        '/evidence?studentProfileId=' +
        f.student.profile.id,
    )
    .set(await headers(other.user));
  expect(r.status).toBe(200);
  expect(r.body.data.items).toHaveLength(0);
});
it('requires an active session for the ownership callback', async () => {
  const r = await request(app()).get(
    '/api/v1/coding/accounts/codeforces/callback?state=' +
      'a'.repeat(43) +
      '&code=example',
  );
  expect(r.status).toBe(401);
  expect(r.headers['referrer-policy']).toBe('no-referrer');
});

it('downloads a private complete five-sheet report with scoped authenticated CSRF POST', async () => {
  const h = await headers(f.owner),
    r = await request(app())
      .post('/api/v1/batches/' + f.batch + '/progress/export')
      .set(h)
      .send({
        reportType: 'COMPLETE',
        format: 'XLSX',
        filters: { page: 9, pageSize: 1 },
        confirmed: true,
      });
  expect(r.status).toBe(200);
  expect(r.headers['cache-control']).toContain('no-store');
  expect(r.body.data.rowCount).toBe(1);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(Buffer.from(r.body.data.base64, 'base64'));
  expect(book.worksheets).toHaveLength(5);
  expect(r.body.data).not.toHaveProperty('url');
  expect(JSON.stringify(r.body.data)).not.toMatch(
    /tokenHash|qrCredential|googleSubject|client_secret/,
  );
});
it('denies report exports without CSRF, matching Origin or current College authority', async () => {
  const h = await headers(f.owner),
    path = '/api/v1/batches/' + f.batch + '/progress/export',
    body = {
      reportType: 'COMPLETE',
      format: 'CSV',
      filters: {},
      confirmed: true,
    };
  expect(
    (await request(app()).post(path).set({ Cookie: h.Cookie }).send(body))
      .status,
  ).toBe(403);
  expect(
    (
      await request(app())
        .post(path)
        .set({ ...h, Origin: 'https://attacker.invalid' })
        .send(body)
    ).status,
  ).toBe(403);
  expect(
    (
      await request(app())
        .post(path)
        .set(await headers(f.admin))
        .send(body)
    ).status,
  ).toBe(403);
});
it('validates report types, unknown fields and required Day filters over HTTP', async () => {
  const h = await headers(f.owner),
    path = '/api/v1/batches/' + f.batch + '/progress/export';
  for (const body of [
    { reportType: 'INVALID', format: 'CSV', filters: {}, confirmed: true },
    { reportType: 'DAY', format: 'CSV', filters: {}, confirmed: true },
    {
      reportType: 'COMPLETE',
      format: 'CSV',
      filters: {},
      confirmed: true,
      includeSecrets: true,
    },
  ])
    expect((await request(app()).post(path).set(h).send(body)).status).toBe(
      400,
    );
});
it('rate limits heavy downloads per authenticated actor', async () => {
  const instance = app(),
    h = await headers(f.owner),
    path = '/api/v1/batches/' + f.batch + '/progress/export';
  for (let i = 0; i < 5; i++)
    expect(
      (
        await request(instance).post(path).set(h).send({
          reportType: 'COMPLETE',
          format: 'CSV',
          filters: {},
          confirmed: true,
        })
      ).status,
    ).toBe(200);
  const r = await request(instance).post(path).set(h).send({
    reportType: 'COMPLETE',
    format: 'CSV',
    filters: {},
    confirmed: true,
  });
  expect(r.status).toBe(429);
  expect(r.body.error.code).toBe('EXPORT_RATE_LIMITED');
});

import { beforeEach, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { SessionService, csrfFor } from '../auth/session-service.js';
import { AdministrationService } from '../administration/service.js';
import { LearningService } from '../learning/service.js';
import { TestLearning, courseInput, batchInput } from './learning-fixtures.js';
import { testUser, collegeInput, newId } from './administration-fixtures.js';
import { identity } from './auth-fixtures.js';
import {
  Course,
  Batch,
  BatchEnrollment,
  EnrollmentImport,
  EnrollmentHistory,
} from '../models/learning.js';
let repo: TestLearning,
  owner: ReturnType<typeof testUser>,
  admin: ReturnType<typeof testUser>,
  student: ReturnType<typeof testUser>,
  batch: string;
beforeEach(async () => {
  repo = new TestLearning();
  owner = testUser({
    role: 'SUPER_ADMIN',
    username: 'sa-owner',
    accountStatus: 'ACTIVE',
  });
  admin = testUser({
    role: 'ADMIN',
    username: 'ad-admin',
    accountStatus: 'ACTIVE',
  });
  student = testUser({ accountStatus: 'ACTIVE' });
  for (const u of [owner, admin, student])
    repo.students.admin.auth.users.set(u.id, u);
  const college = (
    await new AdministrationService(repo.students.admin).createCollege(
      owner.id,
      collegeInput,
      'test',
    )
  ).id;
  await repo.students.admin.read.putAssignment(
    admin.id,
    {
      collegeId: college,
      permissions: [
        'college.view',
        'course.manage',
        'batch.manage',
        'student.enroll',
        'student.view',
      ],
    },
    owner.id,
  );
  const s = new LearningService(repo);
  let c = await s.saveCourse(owner.id, courseInput, undefined, 'test');
  c = await s.courseStatus(
    owner.id,
    c.id,
    'PUBLISHED',
    { expectedRevision: 0, confirmed: true },
    'test',
  );
  batch = (
    await s.saveBatch(owner.id, batchInput(college, c.id), undefined, 'test')
  ).id;
});
function app() {
  return createApp(
    async () => true,
    {
      repository: repo.students.admin.auth,
      google: {
        configured: () => false,
        authorize: async () => '',
        verify: async () => identity,
      },
    },
    repo.students.admin,
    repo.students,
    repo,
  );
}
async function headers(u = owner) {
  const c = await new SessionService(repo.students.admin.auth, 3600).create(u);
  return {
    Cookie: 'algora_session=' + c.token,
    Origin: 'http://localhost:3000',
    'X-CSRF-Token': csrfFor(c.session.tokenHash),
  };
}
it('requires real session authority and rejects spoofed role headers', async () => {
  for (const path of [
    '/courses',
    '/batches',
    '/batches/' + batch + '/enrollments',
    '/students/me/courses',
    '/learning/reconciliation',
  ]) {
    const r = await request(app())
      .get('/api/v1' + path)
      .set('X-Role', 'SUPER_ADMIN');
    expect(r.status).toBe(401);
    expect(r.headers['cache-control']).toContain('no-store');
  }
});
it('protects mutations with Origin/CSRF and rejects protected-field mass assignment', async () => {
  const h = await headers();
  expect(
    (
      await request(app())
        .post('/api/v1/courses')
        .set({ Cookie: h.Cookie })
        .send(courseInput)
    ).status,
  ).toBe(403);
  expect(
    (
      await request(app())
        .post('/api/v1/courses')
        .set(h)
        .send({ ...courseInput, status: 'PUBLISHED' })
    ).status,
  ).toBe(400);
  expect(
    (await request(app()).get('/api/v1/courses?role=SUPER_ADMIN').set(h))
      .status,
  ).toBe(400);
});
it('keeps Student out of private catalog, batch metadata and public self-enrollment', async () => {
  const h = await headers(student);
  for (const path of ['/courses', '/batches', '/batches/' + batch])
    expect(
      (
        await request(app())
          .get('/api/v1' + path)
          .set(h)
      ).status,
    ).toBe(403);
  expect(
    (
      await request(app())
        .post('/api/v1/batches/' + batch + '/enrollments/preview')
        .set(h)
        .send({ kind: 'PASTE', text: '23A91A05B2' })
    ).status,
  ).toBe(403);
});
it('requires roll-only input and rejects fake canonical profile association', async () => {
  const h = await headers(admin);
  const r = await request(app())
    .post('/api/v1/batches/' + batch + '/enrollments')
    .set(h)
    .send({
      email: 'student@example.test',
      studentProfileId: newId(),
      confirmed: true,
    });
  expect(r.status).toBe(400);
  expect(repo.enrollments.size).toBe(0);
});
it('executes a confirmed owner-bound preview with no-store result and safe rows', async () => {
  const instance = app(),
    h = await headers(admin);
  const p = await request(instance)
    .post('/api/v1/batches/' + batch + '/enrollments/preview')
    .set(h)
    .send({ kind: 'PASTE', text: '23A91A05B2\ninvalid' });
  expect(p.status).toBe(200);
  expect(repo.enrollments.size).toBe(0);
  const r = await request(instance)
    .post('/api/v1/batches/' + batch + '/enrollments/import')
    .set(h)
    .send({ previewToken: p.body.data.previewToken, confirmed: true });
  expect(r.status).toBe(200);
  expect(r.headers['cache-control']).toContain('no-store');
  expect(
    r.body.data.results.map((x: { outcome: string }) => x.outcome),
  ).toEqual(['PENDING_REGISTRATION', 'INVALID_ROLL']);
  expect(JSON.stringify(r.body)).not.toMatch(
    /googleSubject|email|phoneNumber|tokenHash/,
  );
});
it('does not expose another Admin preview and denies revoked permissions at confirmation', async () => {
  const h = await headers(admin),
    p = await request(app())
      .post('/api/v1/batches/' + batch + '/enrollments/preview')
      .set(h)
      .send({ kind: 'PASTE', text: '23A91A05B2' });
  const other = await headers(owner);
  expect(
    (
      await request(app())
        .post('/api/v1/batches/' + batch + '/enrollments/import')
        .set(other)
        .send({ previewToken: p.body.data.previewToken, confirmed: true })
    ).status,
  ).toBe(404);
  for (const a of repo.students.admin.assignments.values())
    a.status = 'REVOKED';
  expect(
    (
      await request(app())
        .post('/api/v1/batches/' + batch + '/enrollments/import')
        .set(h)
        .send({ previewToken: p.body.data.previewToken, confirmed: true })
    ).status,
  ).toBe(403);
});
it('fails honestly when storage is unavailable and does not create mocks', async () => {
  const h = await headers();
  repo.students.admin.available = false;
  const r = await request(app())
    .post('/api/v1/courses')
    .set(h)
    .send(courseInput);
  expect(r.status).toBe(503);
  expect(r.body.success).toBe(false);
  expect(repo.courses.size).toBe(1);
});
it('defines global/scoped/partial uniqueness and history/import indexes', () => {
  for (const field of ['code', 'slug'])
    expect(
      Course.schema.indexes().some(([f, o]) => f[field] === 1 && o.unique),
    ).toBe(true);
  expect(
    Batch.schema
      .indexes()
      .some(([f, o]) => f.collegeId === 1 && f.code === 1 && o.unique),
  ).toBe(true);
  for (const field of ['rollNumber', 'studentProfileId'])
    expect(
      BatchEnrollment.schema
        .indexes()
        .some(
          ([f, o]) =>
            f.batchId === 1 &&
            f[field] === 1 &&
            o.unique &&
            !!o.partialFilterExpression,
        ),
    ).toBe(true);
  expect(
    EnrollmentImport.schema
      .indexes()
      .some(([f, o]) => f.tokenHash === 1 && o.unique),
  ).toBe(true);
  expect(
    EnrollmentImport.schema
      .indexes()
      .some(
        ([f, o]) =>
          f.actorUserId === 1 &&
          f.batchId === 1 &&
          f.requestKey === 1 &&
          o.unique,
      ),
  ).toBe(true);
  expect(
    EnrollmentHistory.schema
      .indexes()
      .some(([f]) => f.enrollmentId === 1 && f.createdAt === -1),
  ).toBe(true);
});

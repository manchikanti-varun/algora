import { beforeEach, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { TestCurriculum } from './curriculum-fixtures.js';
import { SessionService, csrfFor } from '../auth/session-service.js';
import { testUser } from './administration-fixtures.js';
import { identity } from './auth-fixtures.js';
import { LearningService } from '../learning/service.js';
import { courseInput } from './learning-fixtures.js';
let repo: TestCurriculum,
  owner: ReturnType<typeof testUser>,
  student: ReturnType<typeof testUser>,
  course: string;
beforeEach(async () => {
  repo = new TestCurriculum();
  owner = testUser({
    role: 'SUPER_ADMIN',
    username: 'sa-owner',
    accountStatus: 'ACTIVE',
  });
  student = testUser({ accountStatus: 'ACTIVE' });
  for (const u of [owner, student])
    repo.learning.students.admin.auth.users.set(u.id, u);
  course = (
    await new LearningService(repo.learning).saveCourse(
      owner.id,
      courseInput,
      undefined,
      'test',
    )
  ).id;
});
const app = () =>
  createApp(
    async () => true,
    {
      repository: repo.learning.students.admin.auth,
      google: {
        configured: () => false,
        authorize: async () => '',
        verify: async () => identity,
      },
    },
    repo.learning.students.admin,
    repo.learning.students,
    repo.learning,
    repo,
  );
async function headers(u = owner) {
  const c = await new SessionService(
    repo.learning.students.admin.auth,
    3600,
  ).create(u);
  return {
    Cookie: 'algora_session=' + c.token,
    Origin: 'http://localhost:3000',
    'X-CSRF-Token': csrfFor(c.session.tokenHash),
  };
}
it.each([
  '/problems',
  '/courses/' + 'a'.repeat(24) + '/curriculum',
  '/batches/' + 'a'.repeat(24) + '/curriculum',
  '/students/me/batches/' + 'a'.repeat(24) + '/days/100',
])('denies unauthenticated curriculum path %s with no-store', async (path) => {
  const r = await request(app())
    .get('/api/v1' + path)
    .set('X-Role', 'SUPER_ADMIN');
  expect(r.status).toBe(401);
  expect(r.headers['cache-control']).toContain('no-store');
});
it('checks CSRF and strict unknown fields before mutation', async () => {
  const h = await headers();
  const path = '/api/v1/courses/' + course + '/curriculum/drafts';
  expect(
    (await request(app()).post(path).set({ Cookie: h.Cookie }).send({})).status,
  ).toBe(403);
  expect(
    (await request(app()).post(path).set(h).send({ publishedBy: owner.id }))
      .status,
  ).toBe(400);
  expect(repo.revisions.size).toBe(0);
});
it('creates draft through real authenticated route and records audit', async () => {
  const r = await request(app())
    .post('/api/v1/courses/' + course + '/curriculum/drafts')
    .set(await headers())
    .send({});
  expect(r.status).toBe(200);
  expect(r.body.data.status).toBe('DRAFT');
  expect(r.headers['cache-control']).toContain('no-store');
  expect(repo.revisions.size).toBe(1);
});
it('denies Student access to authoring and catalog endpoints', async () => {
  const h = await headers(student);
  for (const path of ['/problems', '/courses/' + course + '/curriculum'])
    expect(
      (
        await request(app())
          .get('/api/v1' + path)
          .set(h)
      ).status,
    ).toBe(403);
});
it('rejects unknown catalog query and unsupported canonical URLs', async () => {
  const h = await headers();
  expect(
    (await request(app()).get('/api/v1/problems?role=SUPER_ADMIN').set(h))
      .status,
  ).toBe(400);
  const r = await request(app()).post('/api/v1/problems').set(h).send({
    platform: 'LEETCODE',
    title: 'Unsafe link',
    url: 'https://evil.org/problems/foo',
    difficulty: 'EASY',
  });
  expect(r.status).toBe(400);
  expect(repo.problems.size).toBe(0);
});
it('returns honest unavailable errors when storage is unconfigured', async () => {
  const instance = createApp(
    async () => false,
    {
      repository: repo.learning.students.admin.auth,
      google: {
        configured: () => false,
        authorize: async () => '',
        verify: async () => identity,
      },
    },
    repo.learning.students.admin,
    repo.learning.students,
    repo.learning,
  );
  const r = await request(instance)
    .get('/api/v1/problems')
    .set(await headers());
  expect(r.status).toBe(503);
  expect(r.body.error.code).toBe('CURRICULUM_UNAVAILABLE');
  expect(r.body.error.message).not.toMatch(/mongodb|password|stack/i);
});

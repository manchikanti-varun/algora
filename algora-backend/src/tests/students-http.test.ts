import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { logger } from '../utils/logger.js';
import request from 'supertest';
import { createApp } from '../app.js';
import { SessionService, csrfFor } from '../auth/session-service.js';
import { AdministrationService } from '../administration/service.js';
import { StudentService } from '../students/service.js';
import {
  StudentProfile,
  StudentRollReservation,
} from '../models/student-profile.js';
import { StudentQrCredential } from '../models/student-qr-credential.js';
import { StudentProfileCorrectionRequest } from '../models/student-profile-correction-request.js';
import { destination } from '../auth/types.js';
import { testUser, collegeInput } from './administration-fixtures.js';
import { identity } from './auth-fixtures.js';
import { TestStudents, registrationInput } from './student-fixtures.js';
let repo: TestStudents,
  student: ReturnType<typeof testUser>,
  owner: ReturnType<typeof testUser>,
  college: string;
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
beforeEach(async () => {
  repo = new TestStudents();
  student = testUser();
  owner = testUser({
    role: 'SUPER_ADMIN',
    username: 'sa-owner',
    accountStatus: 'ACTIVE',
  });
  repo.admin.auth.users.set(student.id, student);
  repo.admin.auth.users.set(owner.id, owner);
  college = (
    await new AdministrationService(repo.admin).createCollege(
      owner.id,
      collegeInput,
      'http',
    )
  ).id;
});
function app() {
  return createApp(
    async () => true,
    {
      repository: repo.admin.auth,
      google: {
        configured: () => false,
        authorize: async () => '',
        verify: async () => identity,
      },
    },
    repo.admin,
    repo,
  );
}
async function headers(user = student) {
  const c = await new SessionService(repo.admin.auth, 3600).create(
    repo.admin.auth.users.get(user.id)!,
  );
  return {
    Cookie: 'algora_session=' + c.token,
    Origin: 'http://localhost:3000',
    'X-CSRF-Token': csrfFor(c.session.tokenHash),
  };
}
it('requires session and rejects fabricated user/role headers', async () => {
  for (const path of [
    '/students/me',
    '/students/me/qr',
    '/students/registration-options',
    '/admin/students',
    '/super-admin/students',
  ])
    expect(
      (
        await request(app())
          .get('/api/v1' + path)
          .set('X-Role', 'SUPER_ADMIN')
      ).status,
    ).toBe(401);
});
it('allows incomplete-student registration only with valid session, Origin and CSRF', async () => {
  const h = await headers();
  const body = registrationInput(college);
  expect(
    (
      await request(app())
        .post('/api/v1/students/register')
        .set({ Cookie: h.Cookie })
        .send(body)
    ).status,
  ).toBe(403);
  const r = await request(app())
    .post('/api/v1/students/register')
    .set(h)
    .send(body);
  expect(r.status).toBe(201);
  expect(r.body.data.rollNumber).toBe('23A91A05B2');
  expect(r.headers['cache-control']).toContain('no-store');
  expect(r.body.data).not.toHaveProperty('email');
  expect(
    (await request(app()).get('/api/v1/auth/access/student').set(h)).status,
  ).toBe(403);
  expect(
    (await request(app()).get('/api/v1/students/me').set(h)).body.data.email,
  ).toBe(student.email);
});
it('rejects mass assignment and strict unsupported query fields', async () => {
  const h = await headers();
  expect(
    (
      await request(app())
        .post('/api/v1/students/register')
        .set(h)
        .send({
          ...registrationInput(college),
          email: 'spoof@example.test',
          role: 'ADMIN',
        })
    ).status,
  ).toBe(400);
  expect(
    (
      await request(app())
        .get(
          '/api/v1/students/roll-number-availability?rollNumber=23A91A05B2&userId=spoof',
        )
        .set(h)
    ).status,
  ).toBe(400);
});
it('availability never identifies roll owner', async () => {
  const h = await headers();
  await new StudentService(repo).register(
    student.id,
    registrationInput(college),
    'http',
  );
  const instance = app();
  const r = await request(instance)
    .get('/api/v1/students/roll-number-availability?rollNumber=23a91a05b2')
    .set(h);
  expect(r.body.data).toEqual({ rollNumber: '23A91A05B2', available: false });
});
it('does not provide another student QR lookup or administrative QR access', async () => {
  const h = await headers(owner);
  expect(
    (await request(app()).get('/api/v1/students/me/qr').set(h)).status,
  ).toBe(403);
  expect(
    (
      await request(app())
        .get('/api/v1/super-admin/students/' + student.id + '/qr')
        .set(h)
    ).status,
  ).toBe(404);
});
it('returns safe unavailable errors without secrets and mutation failure stays failure', async () => {
  const h = await headers();
  repo.admin.available = false;
  const r = await request(app())
    .post('/api/v1/students/register')
    .set(h)
    .send(registrationInput(college));
  expect(r.status).toBe(503);
  expect(r.body.success).toBe(false);
  expect(JSON.stringify(r.body)).not.toMatch(
    /mongodb|tokenHash|ciphertext|googleSubject/,
  );
});
it('defines required global unique and scoped indexes with permanent reservations', () => {
  for (const key of ['userId', 'rollNumber', 'studentUsername'])
    expect(
      StudentProfile.schema
        .indexes()
        .some(([fields, opts]) => fields[key] === 1 && opts.unique),
    ).toBe(true);
  expect(
    StudentRollReservation.schema
      .indexes()
      .some(([fields, opts]) => fields.rollNumber === 1 && opts.unique),
  ).toBe(true);
  for (const key of ['profileId', 'tokenHash'])
    expect(
      StudentQrCredential.schema
        .indexes()
        .some(([fields, opts]) => fields[key] === 1 && opts.unique),
    ).toBe(true);
  expect(
    StudentProfileCorrectionRequest.schema
      .indexes()
      .some(
        ([, opts]) =>
          opts.unique && opts.partialFilterExpression?.status === 'PENDING',
      ),
  ).toBe(true);
});
it('maps registration and verification to distinct authoritative destinations', () => {
  expect(destination(student)).toBe('/student/register');
  expect(
    destination({
      ...student,
      accountStatus: 'ACTIVE',
      registrationStatus: 'PENDING_VERIFICATION',
    }),
  ).toBe('/student/profile');
  expect(
    destination({
      ...student,
      accountStatus: 'ACTIVE',
      registrationStatus: 'VERIFIED',
    }),
  ).toBe('/student');
  expect(destination(owner)).toBe('/super-admin');
});
it('session authentication rechecks suspended accounts for profile operations', async () => {
  const h = await headers();
  repo.admin.auth.users.get(student.id)!.accountStatus = 'SUSPENDED';
  expect((await request(app()).get('/api/v1/students/me').set(h)).status).toBe(
    403,
  );
});
it('logs no raw request body, credentials or QR response content', async () => {
  const output = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation(() => true);
  try {
    const h = await headers();
    await request(app())
      .post('/api/v1/students/register')
      .set(h)
      .send(registrationInput(college));
    expect(JSON.stringify(output.mock.calls)).not.toContain('2025550123');
    expect(JSON.stringify(output.mock.calls)).not.toContain(h.Cookie);
  } finally {
    output.mockRestore();
  }
});

it('limits confirmed rotation attempts and keeps credential material out of request logs', async () => {
  vi.stubEnv('QR_ACTIVE_KEY_ID', 'test');
  vi.stubEnv(
    'QR_ENCRYPTION_KEYS',
    JSON.stringify({ test: randomBytes(32).toString('base64') }),
  );
  const log = vi.spyOn(logger, 'info').mockImplementation(() => {});
  const instance = app(),
    h = await headers();
  await request(instance)
    .post('/api/v1/students/register')
    .set(h)
    .send(registrationInput(college));
  const qr = await request(instance).get('/api/v1/students/me/qr').set(h);
  expect(qr.status).toBe(200);
  expect(qr.headers['cache-control']).toContain('no-store');
  expect(qr.body.data.token).toHaveLength(43);
  for (let attempt = 0; attempt < 5; attempt++) {
    const r = await request(instance)
      .post('/api/v1/students/me/qr/rotate')
      .set(h)
      .send({ expectedVersion: 1, confirmed: true });
    expect(r.status).toBe(attempt === 0 ? 200 : 409);
  }
  expect(
    (
      await request(instance)
        .post('/api/v1/students/me/qr/rotate')
        .set(h)
        .send({ expectedVersion: 2, confirmed: true })
    ).status,
  ).toBe(429);
  expect(JSON.stringify(log.mock.calls)).not.toContain(qr.body.data.token);
  expect(JSON.stringify(log.mock.calls)).not.toContain(h.Cookie);
});

import { beforeEach, describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { AdministrationService } from '../administration/service.js';
import { SessionService, csrfFor } from '../auth/session-service.js';
import {
  TestAdministrationRepository,
  testUser,
  collegeInput,
  accessInput,
  approvalInput,
  newId,
} from './administration-fixtures.js';
import { identity } from './auth-fixtures.js';
import { User } from '../models/user.js';
import { College } from '../models/college.js';
import { AdminAccessRequest } from '../models/admin-access-request.js';
import { AdminCollegeAssignment } from '../models/admin-college-assignment.js';
import { AuditLog } from '../models/audit-log.js';
import { idSchema, requestInputSchema } from '../administration/contracts.js';
let repo: TestAdministrationRepository;
let service: AdministrationService;
let owner: ReturnType<typeof testUser>;
let learner: ReturnType<typeof testUser>;
beforeEach(() => {
  repo = new TestAdministrationRepository();
  service = new AdministrationService(repo);
  owner = testUser({
    role: 'SUPER_ADMIN',
    username: 'sa-ownermorgan',
    accountStatus: 'ACTIVE',
  });
  learner = testUser();
  repo.auth.users.set(owner.id, owner);
  repo.auth.users.set(learner.id, learner);
});
function app() {
  return createApp(
    async () => true,
    {
      repository: repo.auth,
      google: {
        configured: () => false,
        authorize: async () => '',
        verify: async () => identity,
      },
    },
    repo,
  );
}
async function credentials(id: string) {
  const created = await new SessionService(repo.auth, 3600).create(
    repo.auth.users.get(id)!,
  );
  return {
    Cookie: 'algora_session=' + created.token,
    Origin: 'http://localhost:3000',
    'X-CSRF-Token': csrfFor(created.session.tokenHash),
  };
}
describe('administration session/CSRF/API boundary', () => {
  it('rejects missing authentication and fabricated role headers', async () => {
    expect(
      (await request(app()).get('/api/v1/super-admin/overview')).status,
    ).toBe(401);
    const headers = await credentials(learner.id);
    expect(
      (
        await request(app())
          .get('/api/v1/super-admin/colleges')
          .set(headers)
          .set('X-Role', 'SUPER_ADMIN')
      ).status,
    ).toBe(403);
  });
  it('rejects mutations without CSRF', async () => {
    const headers = await credentials(owner.id);
    const response = await request(app())
      .post('/api/v1/super-admin/colleges')
      .set('Cookie', headers.Cookie)
      .set('Origin', headers.Origin)
      .send(collegeInput);
    expect(response.status).toBe(403);
    expect(repo.colleges.size).toBe(0);
  });
  it('creates validated colleges and returns normalized data', async () => {
    const response = await request(app())
      .post('/api/v1/super-admin/colleges')
      .set(await credentials(owner.id))
      .send({ ...collegeInput, code: ' example ' });
    expect(response.status).toBe(201);
    expect(response.body.data.code).toBe('EXAMPLE');
    expect(response.headers['cache-control']).toContain('no-store');
  });
  it('rejects mass assignment and query injection', async () => {
    const headers = await credentials(owner.id);
    expect(
      (
        await request(app())
          .post('/api/v1/super-admin/colleges')
          .set(headers)
          .send({ ...collegeInput, createdBy: learner.id })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app())
          .get('/api/v1/super-admin/colleges?page[$gt]=0')
          .set(headers)
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app())
          .get('/api/v1/super-admin/colleges?sort=__proto__')
          .set(headers)
      ).status,
    ).toBe(400);
  });
  it('allows incomplete-student submission using backend identity only', async () => {
    const c = await service.createCollege(owner.id, collegeInput, 'setup');
    const response = await request(app())
      .post('/api/v1/admin-access-requests')
      .set(await credentials(learner.id))
      .send(accessInput(c.id));
    expect(response.status).toBe(201);
    expect(response.body.data.email).toBe(learner.email);
    expect(response.body.data).not.toHaveProperty('internalNote');
    expect(response.body.data).not.toHaveProperty('reviewedBy');
  });
  it('does not accept requester IDs or emails from the browser', async () => {
    const c = await service.createCollege(owner.id, collegeInput, 'setup');
    expect(
      (
        await request(app())
          .post('/api/v1/admin-access-requests')
          .set(await credentials(learner.id))
          .send({
            ...accessInput(c.id),
            requesterUserId: owner.id,
            email: owner.email,
          })
      ).status,
    ).toBe(400);
  });
  it('denies cancellation IDOR and unauthorized approval', async () => {
    const c = await service.createCollege(owner.id, collegeInput, 'setup');
    const pending = await service.submit(
      learner.id,
      accessInput(c.id),
      'setup',
    );
    const other = testUser();
    repo.auth.users.set(other.id, other);
    expect(
      (
        await request(app())
          .post('/api/v1/admin-access-requests/' + pending.id + '/cancel')
          .set(await credentials(other.id))
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app())
          .post('/api/v1/super-admin/admin-requests/' + pending.id + '/approve')
          .set(await credentials(learner.id))
          .send(approvalInput(c.id))
      ).status,
    ).toBe(403);
  });
  it('approves the existing identity, invalidates the old cookie, and admits the reauthenticated Admin without student registration', async () => {
    const c = await service.createCollege(owner.id, collegeInput, 'setup');
    const pending = await service.submit(
      learner.id,
      accessInput(c.id),
      'setup',
    );
    const old = await credentials(learner.id);
    const server = app();
    const response = await request(server)
      .post('/api/v1/super-admin/admin-requests/' + pending.id + '/approve')
      .set(await credentials(owner.id))
      .send(approvalInput(c.id));
    expect(response.status).toBe(200);
    expect(response.body.data.admin.id).toBe(learner.id);
    expect(
      (await request(server).get('/api/v1/admin/me').set(old)).status,
    ).toBe(401);
    expect(
      (
        await request(server)
          .get('/api/v1/auth/access/admin')
          .set(await credentials(learner.id))
      ).status,
    ).toBe(200);
  });
  it('denies cross-college access and excludes unauthorized colleges from own scope', async () => {
    const c = await service.createCollege(owner.id, collegeInput, 'setup');
    const other = await service.createCollege(
      owner.id,
      {
        ...collegeInput,
        name: 'Other Institute',
        code: 'OTHER',
        slug: 'other',
      },
      'setup',
    );
    const pending = await service.submit(
      learner.id,
      accessInput(c.id),
      'setup',
    );
    await service.approve(owner.id, pending.id, approvalInput(c.id), 'setup');
    const headers = await credentials(learner.id);
    const server = app();
    expect(
      (
        await request(server)
          .get('/api/v1/admin/colleges/' + other.id)
          .set(headers)
      ).status,
    ).toBe(403);
    const scope = await request(server)
      .get('/api/v1/admin/colleges')
      .set(headers);
    expect(scope.status).toBe(200);
    expect(scope.body.data.items).toHaveLength(1);
    expect(JSON.stringify(scope.body)).not.toContain(other.name);
  });
  it('enforces submission throttling by authenticated user', async () => {
    const c = await service.createCollege(owner.id, collegeInput, 'setup');
    const server = app();
    const headers = await credentials(learner.id);
    const statuses = [];
    for (let i = 0; i < 4; i++)
      statuses.push(
        (
          await request(server)
            .post('/api/v1/admin-access-requests')
            .set(headers)
            .send(accessInput(c.id))
        ).status,
      );
    expect(statuses).toEqual([201, 409, 409, 429]);
  });
  it('returns a safe database-unavailable response without fake metrics', async () => {
    const server = app();
    const headers = await credentials(owner.id);
    repo.available = false;
    const response = await request(server)
      .get('/api/v1/super-admin/overview')
      .set(headers);
    expect(response.status).toBe(503);
    expect(response.body.success).toBe(false);
    expect(response.body).not.toHaveProperty('data');
  });
  it('sanitizes unexpected repository errors', async () => {
    vi.spyOn(repo.read, 'colleges').mockRejectedValueOnce(
      Error('private credential diagnostic'),
    );
    const response = await request(app())
      .get('/api/v1/super-admin/colleges')
      .set(await credentials(owner.id));
    expect(response.status).toBe(503);
    expect(JSON.stringify(response.body)).not.toContain(
      'credential diagnostic',
    );
  });
  it('exposes no provisioning endpoint or audit mutation endpoint', async () => {
    const headers = await credentials(owner.id);
    expect(
      (
        await request(app())
          .post('/api/v1/super-admin/provision')
          .set(headers)
          .send({ googleSubject: 'anything' })
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app())
          .post('/api/v1/super-admin/audit-logs')
          .set(headers)
          .send({ action: 'FORGED' })
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app())
          .delete('/api/v1/super-admin/audit-logs/' + newId())
          .set(headers)
      ).status,
    ).toBe(404);
  });
});
describe('production model/index contracts without live MongoDB', () => {
  it('canonicalizes ObjectIds before duplicate college selection checks', () => {
    const id = 'abcdef012345abcdef012345';
    expect(idSchema.parse(id.toUpperCase())).toBe(id);
    expect(() =>
      requestInputSchema.parse({
        ...accessInput(id),
        collegeIds: [id, id.toUpperCase()],
      }),
    ).toThrow();
  });
  it('enforces at most one Super Admin in all account states at the database index', () => {
    expect(User.schema.indexes()).toEqual(
      expect.arrayContaining([
        [
          { role: 1 },
          expect.objectContaining({
            unique: true,
            partialFilterExpression: { role: 'SUPER_ADMIN' },
            name: 'one_super_admin',
          }),
        ],
      ]),
    );
  });
  it('declares unique college code, slug and logical identity', () => {
    for (const key of ['code', 'slug', 'identityKey'])
      expect(College.schema.indexes()).toEqual(
        expect.arrayContaining([
          [{ [key]: 1 }, expect.objectContaining({ unique: true })],
        ]),
      );
  });
  it('declares unique pending requests and active assignments', () => {
    expect(AdminAccessRequest.schema.indexes()).toEqual(
      expect.arrayContaining([
        [
          { requesterUserId: 1 },
          expect.objectContaining({
            unique: true,
            partialFilterExpression: { status: 'PENDING' },
          }),
        ],
      ]),
    );
    expect(AdminCollegeAssignment.schema.indexes()).toEqual(
      expect.arrayContaining([
        [
          { adminUserId: 1, collegeId: 1 },
          expect.objectContaining({
            unique: true,
            partialFilterExpression: { status: 'ACTIVE' },
          }),
        ],
      ]),
    );
  });
  it('rejects unexpected audit fields and keeps actor/action immutable', () => {
    expect(AuditLog.schema.path('action').options.immutable).toBe(true);
    const record = new AuditLog({
      actorUserId: newId(),
      actorName: 'Test Owner',
      action: 'COLLEGE_CREATED',
      targetType: 'COLLEGE',
      targetId: newId(),
      requestId: 'fixture',
      metadata: { token: 'not-allowed' },
    });
    expect(record.validateSync()).toBeDefined();
  });
});

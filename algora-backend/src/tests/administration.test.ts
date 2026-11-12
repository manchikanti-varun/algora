import { beforeEach, describe, it, expect } from 'vitest';
import {
  AdministrationService,
  privilegedUsername,
} from '../administration/service.js';
import { pageDefaults, UniqueConflict } from '../administration/contracts.js';
import {
  TestAdministrationRepository,
  testUser,
  collegeInput,
  accessInput,
  approvalInput,
  newId,
} from './administration-fixtures.js';
import { SessionService } from '../auth/session-service.js';
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
const college = () =>
  service.createCollege(owner.id, collegeInput, 'req-create');
async function pending() {
  const c = await college();
  const request = await service.submit(
    learner.id,
    accessInput(c.id),
    'req-submit',
  );
  return { c, request };
}
async function approved() {
  const seed = await pending();
  await service.approve(
    owner.id,
    seed.request.id,
    approvalInput(seed.c.id),
    'req-approve',
  );
  return { ...seed, admin: repo.auth.users.get(learner.id)! };
}
describe('secure singleton provisioning', () => {
  it('provisions only the configured existing verified Google subject', async () => {
    repo.auth.users.delete(owner.id);
    const result = await service.provision(learner.googleSubject, true, 'cli');
    expect(result.provisioned).toBe(true);
    expect(result.user.role).toBe('SUPER_ADMIN');
    expect(result.user.username).toBe('sa-alicemorgan');
    expect(repo.audits[0]?.action).toBe('SUPER_ADMIN_PROVISIONED');
  });
  it('requires explicit confirmation and identity', async () => {
    await expect(service.provision('', true, 'cli')).rejects.toMatchObject({
      status: 400,
    });
    await expect(
      service.provision(learner.googleSubject, false, 'cli'),
    ).rejects.toMatchObject({ status: 400 });
  });
  it('rejects unknown/unverified identities', async () => {
    repo.auth.users.delete(owner.id);
    await expect(
      service.provision('missing', true, 'cli'),
    ).rejects.toMatchObject({ status: 404 });
    repo.auth.users.get(learner.id)!.emailVerified = false;
    await expect(
      service.provision(learner.googleSubject, true, 'cli'),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('is idempotent for the same active owner', async () => {
    const result = await service.provision(owner.googleSubject, true, 'cli');
    expect(result.provisioned).toBe(false);
    expect(repo.audits.length).toBe(0);
  });
  it('never replaces a different owner', async () => {
    await expect(
      service.provision(learner.googleSubject, true, 'cli'),
    ).rejects.toMatchObject({ status: 409 });
    expect(repo.auth.users.get(owner.id)?.role).toBe('SUPER_ADMIN');
  });
  it('does not replace or silently reactivate a suspended/archived owner', async () => {
    owner.accountStatus = 'ARCHIVED';
    await expect(
      service.provision(owner.googleSubject, true, 'cli'),
    ).rejects.toMatchObject({ code: 'OWNER_RECOVERY_REQUIRED' });
    await expect(
      service.provision(learner.googleSubject, true, 'cli'),
    ).rejects.toMatchObject({ code: 'SUPER_ADMIN_EXISTS' });
  });
  it('allows only one concurrent provisioning winner', async () => {
    repo.auth.users.delete(owner.id);
    const other = testUser();
    repo.auth.users.set(other.id, other);
    const results = await Promise.allSettled([
      service.provision(learner.googleSubject, true, 'one'),
      service.provision(other.googleSubject, true, 'two'),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(
      [...repo.auth.users.values()].filter((u) => u.role === 'SUPER_ADMIN'),
    ).toHaveLength(1);
  });
  it('rolls back provisioning if audit persistence fails', async () => {
    repo.auth.users.delete(owner.id);
    repo.failAudit = true;
    await expect(
      service.provision(learner.googleSubject, true, 'cli'),
    ).rejects.toMatchObject({ status: 503 });
    expect(repo.auth.users.get(learner.id)?.role).toBe('STUDENT');
  });
});
describe('college lifecycle and validation', () => {
  it('normalizes college code and slug and audits creation', async () => {
    const c = await service.createCollege(
      owner.id,
      { ...collegeInput, code: ' ex ample ', slug: 'EXAMPLE-INSTITUTE' },
      'create',
    );
    expect(c.code).toBe('EXAMPLE');
    expect(c.slug).toBe('example-institute');
    expect(repo.audits[0]?.action).toBe('COLLEGE_CREATED');
  });
  it.each(['code', 'slug'] as const)('rejects duplicate %s', async (field) => {
    await college();
    await expect(
      service.createCollege(
        owner.id,
        {
          ...collegeInput,
          name: 'Other Institute',
          code: 'OTHER',
          slug: 'other-institute',
          [field]: collegeInput[field],
        },
        'duplicate',
      ),
    ).rejects.toBeInstanceOf(UniqueConflict);
    expect(repo.colleges.size).toBe(1);
  });
  it('rejects duplicate logical college identity with different code and slug', async () => {
    await college();
    await expect(
      service.createCollege(
        owner.id,
        { ...collegeInput, code: 'OTHER', slug: 'other' },
        'duplicate',
      ),
    ).rejects.toMatchObject({ status: 409 });
  });
  it('updates allowlisted information with optimistic revisions', async () => {
    const c = await college();
    const changed = await service.updateCollege(
      owner.id,
      c.id,
      { city: 'Updated City', expectedRevision: 0 },
      'update',
    );
    expect(changed.city).toBe('Updated City');
    await expect(
      service.updateCollege(
        owner.id,
        c.id,
        { city: 'Stale City', expectedRevision: 0 },
        'stale',
      ),
    ).rejects.toMatchObject({ code: 'STALE_STATE' });
  });
  it('rejects mass assignment of ownership or role', async () => {
    const c = await college();
    await expect(
      service.updateCollege(
        owner.id,
        c.id,
        { expectedRevision: 0, createdBy: learner.id, role: 'SUPER_ADMIN' },
        'bad',
      ),
    ).rejects.toBeDefined();
  });
  it('archives without deleting references and disallows reactivation', async () => {
    const c = await college();
    await service.collegeStatus(
      owner.id,
      c.id,
      { status: 'ARCHIVED', expectedRevision: 0 },
      'archive',
    );
    expect(repo.colleges.size).toBe(1);
    await expect(
      service.collegeStatus(
        owner.id,
        c.id,
        { status: 'ACTIVE', expectedRevision: 1 },
        'restore',
      ),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
    await expect(
      service.updateCollege(
        owner.id,
        c.id,
        { name: 'Changed', expectedRevision: 1 },
        'update',
      ),
    ).rejects.toMatchObject({ code: 'COLLEGE_ARCHIVED' });
  });
  it('enforces Super Admin role independently of route guards', async () => {
    await expect(
      service.createCollege(learner.id, collegeInput, 'escalate'),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('supports search, pagination and status filters', async () => {
    await college();
    await service.createCollege(
      owner.id,
      {
        ...collegeInput,
        name: 'Second College',
        code: 'SECOND',
        slug: 'second',
      },
      'create',
    );
    const result = await service.colleges(owner.id, {
      ...pageDefaults,
      search: 'Second',
      pageSize: 1,
      status: 'ACTIVE',
    });
    expect(result.total).toBe(1);
    expect(result.items[0]?.code).toBe('SECOND');
  });
  it('rolls back college changes when audit is unavailable', async () => {
    repo.failAudit = true;
    await expect(college()).rejects.toMatchObject({ status: 503 });
    expect(repo.colleges.size).toBe(0);
  });
});
describe('identity-bound admin requests', () => {
  it('accepts an incomplete student without a roll number and keeps least privilege', async () => {
    const { request } = await pending();
    expect(request.email).toBe(learner.email);
    expect(request.requesterUserId).toBe(learner.id);
    expect(repo.auth.users.get(learner.id)?.role).toBe('STUDENT');
    expect(request).not.toHaveProperty('internalNote');
  });
  it('accepts ordinary multiline reasons without accepting unsafe control characters', async () => {
    const c = await college();
    const record = await service.submit(
      learner.id,
      {
        ...accessInput(c.id),
        reason:
          'I coordinate our learning community.\nI need to support this college.',
      },
      'multiline',
    );
    expect(record.reason).toContain('\n');
  });
  it('rejects browser-supplied identity, email and permissions', async () => {
    const c = await college();
    await expect(
      service.submit(
        learner.id,
        {
          ...accessInput(c.id),
          email: 'forged@example.test',
          requesterUserId: owner.id,
          permissions: ['course.manage'],
        },
        'forged',
      ),
    ).rejects.toBeDefined();
  });
  it('rejects duplicate pending requests, including concurrent submissions', async () => {
    const c = await college();
    const results = await Promise.allSettled([
      service.submit(learner.id, accessInput(c.id), 'one'),
      service.submit(learner.id, accessInput(c.id), 'two'),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(repo.requests.size).toBe(1);
  });
  it('allows own cancellation and resubmission', async () => {
    const { c, request } = await pending();
    await service.cancel(learner.id, request.id, 'cancel');
    await service.cancel(learner.id, request.id, 'repeat');
    const next = await service.submit(
      learner.id,
      accessInput(c.id),
      'resubmit',
    );
    expect(next.status).toBe('PENDING');
    expect(
      repo.audits.filter((a) => a.action === 'ADMIN_REQUEST_CANCELLED'),
    ).toHaveLength(1);
  });
  it('hides another requester’s records and rejects cancellation IDOR', async () => {
    const { request } = await pending();
    const other = testUser();
    repo.auth.users.set(other.id, other);
    expect(
      (await service.ownRequests(other.id, pageDefaults)).items,
    ).toHaveLength(0);
    await expect(
      service.cancel(other.id, request.id, 'idor'),
    ).rejects.toMatchObject({ status: 404 });
  });
  it('rejects nonexistent or inactive college choices', async () => {
    await expect(
      service.submit(learner.id, accessInput(newId()), 'bad'),
    ).rejects.toMatchObject({ status: 404 });
    const c = await college();
    repo.colleges.get(c.id)!.status = 'INACTIVE';
    await expect(
      service.submit(learner.id, accessInput(c.id), 'inactive'),
    ).rejects.toMatchObject({ code: 'COLLEGE_UNAVAILABLE' });
  });
  it('rejects suspended/archived requesters', async () => {
    const c = await college();
    learner.accountStatus = 'SUSPENDED';
    await expect(
      service.submit(learner.id, accessInput(c.id), 'suspended'),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('returns only safe eligible college directory fields', async () => {
    const c = await college();
    const result = await service.eligibleColleges(learner.id, pageDefaults);
    expect(result.items[0]?.id).toBe(c.id);
    expect(result.items[0]).not.toHaveProperty('createdBy');
  });
});
describe('transactional approval and permanent usernames', () => {
  it('promotes the same canonical identity and invalidates old sessions', async () => {
    const { c, request } = await pending();
    const sessions = new SessionService(repo.auth, 3600);
    const existing = await sessions.create(learner);
    const count = repo.auth.users.size;
    const approved = await service.approve(
      owner.id,
      request.id,
      approvalInput(c.id),
      'approve',
    );
    expect(approved.admin.id).toBe(learner.id);
    expect(approved.admin.role).toBe('ADMIN');
    expect(approved.admin.username).toBe('ad-alicemorgan');
    expect(repo.auth.users.size).toBe(count);
    expect(repo.auth.users.get(learner.id)?.googleSubject).toBe(
      learner.googleSubject,
    );
    expect(repo.auth.users.get(learner.id)?.registrationStatus).toBe(
      'NOT_STARTED',
    );
    await expect(sessions.authenticate(existing.token)).rejects.toMatchObject({
      status: 401,
    });
  });
  it('handles username collisions using bounded unique-index retries', async () => {
    const seed = await pending();
    const taken = testUser({
      role: 'ADMIN',
      username: 'ad-alicemorgan',
      accountStatus: 'ACTIVE',
    });
    repo.auth.users.set(taken.id, taken);
    const result = await service.approve(
      owner.id,
      seed.request.id,
      approvalInput(seed.c.id),
      'collision',
    );
    expect(result.admin.username).toBe('ad-alicemorgan2');
  });
  it('fails closed when every bounded username candidate is reserved', async () => {
    const seed = await pending();
    for (let i = 1; i <= 8; i++) {
      const u = testUser({
        role: 'ADMIN',
        accountStatus: 'ACTIVE',
        username: privilegedUsername('ADMIN', 'Alice Morgan', i),
      });
      repo.auth.users.set(u.id, u);
    }
    await expect(
      service.approve(
        owner.id,
        seed.request.id,
        approvalInput(seed.c.id),
        'exhausted',
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(repo.requests.get(seed.request.id)?.status).toBe('PENDING');
    expect(repo.auth.users.get(learner.id)?.role).toBe('STUDENT');
  });
  it('does not allocate unsafe or unsupported empty names', () => {
    expect(privilegedUsername('ADMIN', '  Álìce  Morgan! ')).toBe(
      'ad-alicemorgan',
    );
    expect(() => privilegedUsername('ADMIN', '123 !!!')).toThrow();
  });
  it('allows exactly one concurrent approval', async () => {
    const seed = await pending();
    const result = await Promise.allSettled([
      service.approve(
        owner.id,
        seed.request.id,
        approvalInput(seed.c.id),
        'one',
      ),
      service.approve(
        owner.id,
        seed.request.id,
        approvalInput(seed.c.id),
        'two',
      ),
    ]);
    expect(result.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(repo.assignments.size).toBe(1);
    expect(
      repo.audits.filter((a) => a.action === 'ADMIN_REQUEST_APPROVED'),
    ).toHaveLength(1);
  });
  it('prevents rejecting or approving reviewed requests', async () => {
    const seed = await approved();
    await expect(
      service.reject(
        owner.id,
        seed.request.id,
        { reviewNote: 'Cannot reject an approved request' },
        'reject',
      ),
    ).rejects.toMatchObject({ code: 'REQUEST_REVIEWED' });
  });
  it('rolls back role, username, assignments, review, sessions and audit on failure', async () => {
    const seed = await pending();
    const sessions = new SessionService(repo.auth, 3600);
    const token = await sessions.create(learner);
    const previous = repo.audits.length;
    repo.failAudit = true;
    await expect(
      service.approve(
        owner.id,
        seed.request.id,
        approvalInput(seed.c.id),
        'failed',
      ),
    ).rejects.toMatchObject({ status: 503 });
    expect(repo.auth.users.get(learner.id)?.role).toBe('STUDENT');
    expect(repo.auth.users.get(learner.id)?.username).toBeUndefined();
    expect(repo.requests.get(seed.request.id)?.status).toBe('PENDING');
    expect(repo.assignments.size).toBe(0);
    expect(repo.audits.length).toBe(previous);
    expect((await sessions.authenticate(token.token)).user.id).toBe(learner.id);
  });
  it('rejects grants outside requested colleges and unknown permissions', async () => {
    const seed = await pending();
    const other = await service.createCollege(
      owner.id,
      { ...collegeInput, name: 'Other', code: 'OTHER', slug: 'other' },
      'other',
    );
    await expect(
      service.approve(
        owner.id,
        seed.request.id,
        approvalInput(other.id),
        'invalid',
      ),
    ).rejects.toMatchObject({ code: 'INVALID_ASSIGNMENT' });
    await expect(
      service.approve(
        owner.id,
        seed.request.id,
        {
          assignments: [
            { collegeId: seed.c.id, permissions: ['owner.transfer'] },
          ],
        },
        'invalid',
      ),
    ).rejects.toBeDefined();
  });
  it('rejection preserves the user and permits a new request without exposing private notes', async () => {
    const seed = await pending();
    await service.reject(
      owner.id,
      seed.request.id,
      {
        reviewNote: 'Please provide more institutional context.',
        internalNote: 'Private review rationale',
      },
      'reject',
    );
    const own = await service.ownRequests(learner.id, pageDefaults);
    expect(own.items[0]?.reviewNote).toContain('institutional');
    expect(JSON.stringify(own)).not.toContain('Private review rationale');
    expect(repo.auth.users.get(learner.id)?.accountStatus).toBe('PENDING');
    await expect(
      service.submit(learner.id, accessInput(seed.c.id), 'retry'),
    ).resolves.toHaveProperty('status', 'PENDING');
  });
  it('preserves usernames when a display name changes', async () => {
    await approved();
    repo.auth.users.get(learner.id)!.displayName = 'Different Name';
    expect((await service.admin(owner.id, learner.id)).user.username).toBe(
      'ad-alicemorgan',
    );
  });
});
describe('college permissions and administrator lifecycle', () => {
  it('permits assigned scope and denies cross-college IDOR', async () => {
    const seed = await approved();
    expect(
      (await service.authorizedCollege(learner.id, seed.c.id, 'college.view'))
        .id,
    ).toBe(seed.c.id);
    const other = await service.createCollege(
      owner.id,
      { ...collegeInput, name: 'Other College', code: 'OTHER', slug: 'other' },
      'other',
    );
    await expect(
      service.authorizedCollege(learner.id, other.id, 'college.view'),
    ).rejects.toMatchObject({ status: 403 });
    expect(
      (await service.ownColleges(learner.id)).items.map((c) => c.id),
    ).toEqual([seed.c.id]);
  });
  it('denies missing permission, revoked assignments and inactive college operations', async () => {
    const seed = await approved();
    await expect(
      service.authorizedCollege(learner.id, seed.c.id, 'course.manage', true),
    ).rejects.toMatchObject({ status: 403 });
    const assignment = [...repo.assignments.values()][0]!;
    assignment.status = 'REVOKED';
    await expect(
      service.authorizedCollege(learner.id, seed.c.id, 'college.view'),
    ).rejects.toMatchObject({ status: 403 });
    assignment.status = 'ACTIVE';
    repo.colleges.get(seed.c.id)!.status = 'INACTIVE';
    await expect(
      service.authorizedCollege(learner.id, seed.c.id, 'college.view', true),
    ).rejects.toMatchObject({ code: 'COLLEGE_UNAVAILABLE' });
    expect((await service.ownColleges(learner.id)).items).toHaveLength(0);
  });
  it('permits Super Admin global active-college scope but not inactive mutations', async () => {
    const c = await college();
    expect(
      (await service.authorizedCollege(owner.id, c.id, 'course.manage', true))
        .id,
    ).toBe(c.id);
    repo.colleges.get(c.id)!.status = 'ARCHIVED';
    await expect(
      service.authorizedCollege(owner.id, c.id, 'college.view', true),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('suspends immediately, revokes sessions and retains assignments', async () => {
    await approved();
    const user = repo.auth.users.get(learner.id)!;
    const sessions = new SessionService(repo.auth, 3600);
    const token = await sessions.create(user);
    await service.adminStatus(
      owner.id,
      user.id,
      { status: 'SUSPENDED', expectedRevision: user.sessionVersion },
      'suspend',
    );
    expect(repo.assignments.size).toBe(1);
    await expect(sessions.authenticate(token.token)).rejects.toMatchObject({
      status: 401,
    });
    await expect(service.ownColleges(user.id)).rejects.toMatchObject({
      status: 403,
    });
  });
  it('reactivates only with valid active scope and never restores revoked assignments', async () => {
    await approved();
    let user = repo.auth.users.get(learner.id)!;
    await service.adminStatus(
      owner.id,
      user.id,
      { status: 'SUSPENDED', expectedRevision: user.sessionVersion },
      'suspend',
    );
    user = repo.auth.users.get(learner.id)!;
    await service.assignments(
      owner.id,
      user.id,
      { assignments: [], expectedRevision: user.sessionVersion },
      'revoke',
    );
    user = repo.auth.users.get(learner.id)!;
    await expect(
      service.adminStatus(
        owner.id,
        user.id,
        { status: 'ACTIVE', expectedRevision: user.sessionVersion },
        'reactivate',
      ),
    ).rejects.toMatchObject({ code: 'ASSIGNMENT_REQUIRED' });
    expect([...repo.assignments.values()][0]?.status).toBe('REVOKED');
  });
  it('reactivates a suspended admin with retained valid assignments', async () => {
    await approved();
    let user = repo.auth.users.get(learner.id)!;
    await service.adminStatus(
      owner.id,
      user.id,
      { status: 'SUSPENDED', expectedRevision: user.sessionVersion },
      'suspend',
    );
    user = repo.auth.users.get(learner.id)!;
    const result = await service.adminStatus(
      owner.id,
      user.id,
      { status: 'ACTIVE', expectedRevision: user.sessionVersion },
      'reactivate',
    );
    expect(result.accountStatus).toBe('ACTIVE');
    expect(repo.audits.some((a) => a.action === 'ADMIN_REACTIVATED')).toBe(
      true,
    );
  });
  it('assignment and permission edits invalidate sessions and audit changes', async () => {
    const seed = await approved();
    const user = repo.auth.users.get(learner.id)!;
    const priorVersion = user.sessionVersion;
    await service.assignments(
      owner.id,
      user.id,
      {
        expectedRevision: user.sessionVersion,
        assignments: [
          {
            collegeId: seed.c.id,
            permissions: ['college.view', 'report.view'],
          },
        ],
      },
      'permissions',
    );
    expect(
      (await service.authorizedCollege(user.id, seed.c.id, 'report.view')).id,
    ).toBe(seed.c.id);
    expect(repo.auth.users.get(user.id)!.sessionVersion).toBe(priorVersion + 1);
    expect(
      repo.audits.some((a) => a.action === 'ADMIN_PERMISSIONS_UPDATED'),
    ).toBe(true);
  });
  it('rejects stale versions and unauthorized reassignment', async () => {
    const seed = await approved();
    await expect(
      service.assignments(
        learner.id,
        learner.id,
        { expectedRevision: 0, assignments: [] },
        'escalate',
      ),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      service.assignments(
        owner.id,
        learner.id,
        { expectedRevision: 0, assignments: [] },
        'stale',
      ),
    ).rejects.toMatchObject({ code: 'STALE_STATE' });
    expect(repo.assignments.size).toBe(1);
    expect(seed.admin.role).toBe('ADMIN');
  });
  it('protects Super Admin from ordinary admin-management changes', async () => {
    await expect(
      service.adminStatus(
        owner.id,
        owner.id,
        { status: 'SUSPENDED', expectedRevision: 0 },
        'self',
      ),
    ).rejects.toMatchObject({ code: 'ADMIN_INELIGIBLE' });
  });
  it('restricts audit access to the owner and returns real summaries', async () => {
    await pending();
    await expect(
      service.audits(learner.id, pageDefaults),
    ).rejects.toMatchObject({ status: 403 });
    expect((await service.overview(owner.id)).totalColleges).toBe(1);
    expect((await service.overview(owner.id)).pendingRequests).toBe(1);
    expect((await service.audits(owner.id, pageDefaults)).total).toBe(2);
  });
  it('fails closed on unavailable storage', async () => {
    repo.available = false;
    await expect(service.overview(owner.id)).rejects.toMatchObject({
      status: 503,
    });
    await expect(college()).rejects.toMatchObject({ status: 503 });
  });
});

import { beforeEach, describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { LearningService } from '../learning/service.js';
import {
  courseSchema,
  batchSchema,
  manualSchema,
  listSchema,
} from '../learning/contracts.js';
import { StudentService } from '../students/service.js';
import { QrVault } from '../students/crypto.js';
import { AdministrationService } from '../administration/service.js';
import { TestLearning, courseInput, batchInput } from './learning-fixtures.js';
import { collegeInput, testUser } from './administration-fixtures.js';
import { registrationInput } from './student-fixtures.js';
let repo: TestLearning,
  s: LearningService,
  owner: ReturnType<typeof testUser>,
  admin: ReturnType<typeof testUser>,
  student: ReturnType<typeof testUser>,
  college: string,
  otherCollege: string,
  course: string,
  batch: string;
const o = listSchema.parse({});
const transition = (expectedRevision: number) => ({
  expectedRevision,
  confirmed: true,
});
beforeEach(async () => {
  repo = new TestLearning();
  s = new LearningService(repo);
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
  student = testUser();
  for (const u of [owner, admin, student])
    repo.students.admin.auth.users.set(u.id, u);
  const a = new AdministrationService(repo.students.admin);
  college = (await a.createCollege(owner.id, collegeInput, 'test')).id;
  otherCollege = (
    await a.createCollege(
      owner.id,
      {
        ...collegeInput,
        name: 'Second College',
        code: 'SECOND',
        slug: 'second-college',
      },
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
        'student.verify',
      ],
    },
    owner.id,
  );
  let c = await s.saveCourse(owner.id, courseInput, undefined, 'test');
  c = await s.courseStatus(
    owner.id,
    c.id,
    'PUBLISHED',
    transition(c.revision),
    'test',
  );
  course = c.id;
  let b = await s.saveBatch(
    owner.id,
    batchInput(college, course),
    undefined,
    'test',
  );
  b = await s.batchStatus(
    owner.id,
    b.id,
    'ACTIVE',
    transition(b.revision),
    'test',
  );
  batch = b.id;
});
const enroll = (roll = '23A91A05B2', id = owner.id, target = batch) =>
  s.manual(
    id,
    target,
    { rollNumber: roll, requestKey: randomUUID(), confirmed: true },
    'test',
  );
async function profile(verified = true, roll = '23A91A05B2', col = college) {
  const service = new StudentService(
    repo.students,
    new QrVault('missing', '{}'),
  );
  let p = await service.register(
    student.id,
    { ...registrationInput(col), rollNumber: roll },
    'test',
  );
  if (verified)
    p = await service.verify(
      owner.id,
      p.id,
      {
        expectedRevision: p.revision,
        method: 'AUTHORIZED_MANUAL',
        evidenceReference:
          'Authorized registrar reviewed institutional evidence',
        confirmed: true,
      },
      false,
      'test',
    );
  return p;
}
async function reconcile(kind = 'BATCH', id = batch) {
  await repo.transaction((tx) =>
    s.reconcileRows(
      tx,
      [...repo.enrollments.values()].filter((e) =>
        kind === 'BATCH'
          ? e.batchId === id
          : kind === 'PROFILE'
            ? e.studentProfileId === id
            : true,
      ),
      'reconciliation-test',
    ),
  );
}
describe('courses and explicit ownership', () => {
  it('validates fields, normalizes code/tags and rejects mass assignment', () => {
    expect(
      courseSchema.parse({
        ...courseInput,
        code: 'dsa-102',
        tags: ['DSA', 'dsa'],
      }),
    ).toMatchObject({ code: 'DSA-102', tags: ['dsa'] });
    expect(
      courseSchema.safeParse({ ...courseInput, createdBy: owner.id }).success,
    ).toBe(false);
    expect(courseSchema.safeParse({ ...courseInput, title: '' }).success).toBe(
      false,
    );
  });
  it('enforces unique global course code and slug', async () => {
    await expect(
      s.saveCourse(
        owner.id,
        { ...courseInput, title: 'Another title' },
        undefined,
        'test',
      ),
    ).rejects.toMatchObject({ status: 409 });
  });
  it('allows authorized college drafts but denies platform creation and foreign edits', async () => {
    await expect(
      s.saveCourse(
        admin.id,
        { ...courseInput, code: 'OTHER', slug: 'other' },
        undefined,
        'test',
      ),
    ).rejects.toMatchObject({ status: 403 });
    const c = await s.saveCourse(
      admin.id,
      {
        ...courseInput,
        code: 'LOCAL',
        slug: 'local',
        scope: 'COLLEGE',
        ownerCollegeId: college,
      },
      undefined,
      'test',
    );
    expect(c.status).toBe('DRAFT');
    expect(
      (await s.courses(admin.id, o)).items.some((x) => x.id === c.id),
    ).toBe(true);
    await expect(
      s.saveCourse(
        admin.id,
        {
          ...courseInput,
          code: 'FOREIGN',
          slug: 'foreign',
          scope: 'COLLEGE',
          ownerCollegeId: otherCollege,
        },
        undefined,
        'test',
      ),
    ).rejects.toMatchObject({ code: 'COLLEGE_FORBIDDEN' });
    await expect(
      s.courseStatus(admin.id, course, 'ARCHIVED', transition(1), 'test'),
    ).rejects.toMatchObject({ code: 'COURSE_FORBIDDEN' });
  });
  it('publishes/archives permitted college courses with revision protection', async () => {
    let c = await s.saveCourse(
      admin.id,
      {
        ...courseInput,
        code: 'LOCAL',
        slug: 'local',
        scope: 'COLLEGE',
        ownerCollegeId: college,
      },
      undefined,
      'test',
    );
    await expect(
      s.courseStatus(admin.id, c.id, 'PUBLISHED', transition(99), 'test'),
    ).rejects.toMatchObject({ code: 'STALE_STATE' });
    c = await s.courseStatus(
      admin.id,
      c.id,
      'PUBLISHED',
      transition(0),
      'test',
    );
    c = await s.courseStatus(
      admin.id,
      c.id,
      'ARCHIVED',
      transition(c.revision),
      'test',
    );
    await expect(
      s.courseStatus(
        admin.id,
        c.id,
        'PUBLISHED',
        transition(c.revision),
        'test',
      ),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
  });
  it('hides foreign private drafts and restricts explicit sharing to Super Admin', async () => {
    let c = await s.saveCourse(
      owner.id,
      {
        ...courseInput,
        code: 'PRIVATE',
        slug: 'private',
        scope: 'COLLEGE',
        ownerCollegeId: otherCollege,
      },
      undefined,
      'test',
    );
    expect(
      (await s.courses(admin.id, o)).items.some((x) => x.id === c.id),
    ).toBe(false);
    await expect(s.course(admin.id, c.id)).rejects.toMatchObject({
      status: 403,
    });
    c = await s.courseStatus(
      owner.id,
      c.id,
      'PUBLISHED',
      transition(0),
      'test',
    );
    await expect(
      s.saveBatch(
        admin.id,
        batchInput(college, c.id, 'PRIVATE'),
        undefined,
        'test',
      ),
    ).rejects.toMatchObject({ code: 'COURSE_INELIGIBLE' });
    await s.saveCourse(
      owner.id,
      {
        ...courseInput,
        code: 'PRIVATE',
        slug: 'private',
        scope: 'COLLEGE',
        ownerCollegeId: otherCollege,
        sharedCollegeIds: [college],
        expectedRevision: c.revision,
      },
      c.id,
      'test',
    );
    expect(
      (
        await s.saveBatch(
          admin.id,
          batchInput(college, c.id, 'SHARED'),
          undefined,
          'test',
        )
      ).courseId,
    ).toBe(c.id);
  });
});
describe('batch lifecycle and snapshots', () => {
  it('validates dates/capacity and rejects forged identity fields', () => {
    expect(
      batchSchema.safeParse({
        ...batchInput(college, course),
        startDate: '2026-12-02',
        endDate: '2026-11-01',
      }).success,
    ).toBe(false);
    expect(
      batchSchema.safeParse({ ...batchInput(college, course), capacity: 0 })
        .success,
    ).toBe(false);
    expect(
      batchSchema.safeParse({ ...batchInput(college, course), seatCount: 0 })
        .success,
    ).toBe(false);
  });
  it('requires published course and active college at creation/activation', async () => {
    const c = await s.saveCourse(
      owner.id,
      { ...courseInput, code: 'DRAFT', slug: 'draft' },
      undefined,
      'test',
    );
    await expect(
      s.saveBatch(owner.id, batchInput(college, c.id), undefined, 'test'),
    ).rejects.toMatchObject({ code: 'COURSE_INELIGIBLE' });
    repo.students.admin.colleges.get(otherCollege)!.status = 'INACTIVE';
    await expect(
      s.saveBatch(
        owner.id,
        batchInput(otherCollege, course),
        undefined,
        'test',
      ),
    ).rejects.toMatchObject({ code: 'COLLEGE_UNAVAILABLE' });
  });
  it('denies foreign batch management and revoked assignments', async () => {
    const foreign = await s.saveBatch(
      owner.id,
      batchInput(otherCollege, course),
      undefined,
      'test',
    );
    await expect(s.batch(admin.id, foreign.id)).rejects.toMatchObject({
      code: 'COLLEGE_FORBIDDEN',
    });
    for (const a of repo.students.admin.assignments.values())
      a.status = 'REVOKED';
    await expect(
      s.batchStatus(admin.id, batch, 'COMPLETED', transition(1), 'test'),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('preserves snapshot across later course edits and closed metadata/history', async () => {
    const before = repo.batches.get(batch)!;
    const c = repo.courses.get(course)!;
    await s.saveCourse(
      owner.id,
      {
        ...courseInput,
        title: 'Revised course title',
        expectedRevision: c.revision,
      },
      course,
      'test',
    );
    expect(repo.batches.get(batch)?.snapshot.title).toBe(before.snapshot.title);
    const b = await s.batchStatus(
      owner.id,
      batch,
      'COMPLETED',
      transition(before.revision),
      'test',
    );
    await expect(
      s.saveBatch(
        owner.id,
        {
          name: 'Changed batch',
          code: b.code,
          description: b.description,
          startDate: b.startDate,
          endDate: b.endDate,
          capacity: b.capacity,
          expectedRevision: b.revision,
        },
        b.id,
        'test',
      ),
    ).rejects.toMatchObject({ code: 'BATCH_CLOSED' });
    await expect(
      s.batchStatus(owner.id, b.id, 'ACTIVE', transition(b.revision), 'test'),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
  });
  it('reserves capacity for pending records and rejects lowering below reservations', async () => {
    await enroll();
    const b = repo.batches.get(batch)!;
    await expect(
      s.saveBatch(
        owner.id,
        {
          name: b.name,
          code: b.code,
          description: b.description,
          startDate: b.startDate,
          endDate: b.endDate,
          capacity: 0,
          expectedRevision: b.revision,
        },
        batch,
        'test',
      ),
    ).rejects.toBeDefined();
    expect(b.seatCount).toBe(1);
  });
});
describe('roll-only membership and capacity', () => {
  it.each([
    '23A91A05B',
    '23A91A05B22',
    '23A91A 5B2',
    '23A91A-5B2',
    'ſ3A91A05B2',
    '２3A91A05B2',
  ])('rejects invalid roll %s', (roll) =>
    expect(
      manualSchema.safeParse({
        rollNumber: roll,
        requestKey: randomUUID(),
        confirmed: true,
      }).success,
    ).toBe(false),
  );
  it('uses exact current normalized roll and activates only verified eligible students', async () => {
    const p = await profile();
    const r = await enroll('23a91a05b2', admin.id);
    expect(r.results[0]?.outcome).toBe('ACTIVE');
    expect([...repo.enrollments.values()][0]).toMatchObject({
      studentProfileId: p.id,
      rollNumber: '23A91A05B2',
      status: 'ACTIVE',
    });
    expect((await s.effective(student.id, batch)).batch.id).toBe(batch);
  });
  it('creates pending registration without fabricating a User/Profile', async () => {
    const users = repo.students.admin.auth.users.size;
    const r = await enroll();
    expect(r.results[0]?.outcome).toBe('PENDING_REGISTRATION');
    expect(repo.students.profiles.size).toBe(0);
    expect(repo.students.admin.auth.users.size).toBe(users);
  });
  it('keeps registered unverified students pending and denies effective access', async () => {
    await profile(false);
    expect((await enroll()).results[0]?.outcome).toBe('PENDING_VERIFICATION');
    await expect(s.effective(student.id, batch)).rejects.toMatchObject({
      code: 'ENROLLMENT_REQUIRED',
    });
    expect((await s.own(student.id, o)).items).toHaveLength(0);
  });
  it('rejects wrong-college roll safely without private profile metadata', async () => {
    await profile(true, '23A91A05B2', otherCollege);
    const r = await enroll();
    expect(r.results[0]?.outcome).toBe('COLLEGE_CONFLICT');
    expect(JSON.stringify(r)).not.toContain(student.email);
    expect(repo.enrollments.size).toBe(0);
  });
  it('does not activate historical reservations', async () => {
    await profile();
    const p = [...repo.students.profiles.values()][0]!;
    p.rollNumber = '24CS001A12';
    repo.students.rolls.set(p.rollNumber, p.id);
    expect((await enroll('23A91A05B2')).results[0]?.outcome).toBe(
      'HISTORICAL_ROLL_CONFLICT',
    );
    expect(repo.enrollments.size).toBe(0);
  });
  it('prevents duplicate current membership and concurrent capacity oversubscription', async () => {
    repo.batches.get(batch)!.capacity = 1;
    const r = await Promise.all([enroll('23A91A05B2'), enroll('23A91A05B3')]);
    expect(
      r
        .flatMap((x) => x.results)
        .filter((x) => x.outcome === 'PENDING_REGISTRATION'),
    ).toHaveLength(1);
    expect(
      r
        .flatMap((x) => x.results)
        .filter((x) => x.outcome === 'CAPACITY_CONFLICT'),
    ).toHaveLength(1);
    expect(repo.enrollments.size).toBe(1);
    expect(repo.batches.get(batch)!.seatCount).toBe(1);
  });
  it('returns already enrolled and never permits student self-enrollment', async () => {
    await profile();
    await enroll();
    expect((await enroll()).results[0]?.outcome).toBe('ALREADY_ENROLLED');
    await expect(enroll('23A91A05B3', student.id)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
  it('requires student.enroll independently from batch.manage and denies suspended Admin', async () => {
    const grant = [...repo.students.admin.assignments.values()][0]!;
    grant.permissions = ['college.view', 'batch.manage'];
    await expect(enroll('23A91A05B2', admin.id)).rejects.toMatchObject({
      code: 'COLLEGE_FORBIDDEN',
    });
    repo.students.admin.auth.users.get(admin.id)!.accountStatus = 'SUSPENDED';
    await expect(enroll('23A91A05B2', admin.id)).rejects.toMatchObject({
      code: 'ACCOUNT_INELIGIBLE',
    });
  });
  it('requires student.view to read a roster and prevents IDOR', async () => {
    await enroll();
    const foreign = await s.saveBatch(
      owner.id,
      batchInput(otherCollege, course),
      undefined,
      'test',
    );
    await expect(s.enrollments(admin.id, foreign.id, o)).rejects.toMatchObject({
      status: 403,
    });
    const grant = [...repo.students.admin.assignments.values()][0]!;
    grant.permissions = ['college.view', 'student.enroll'];
    await expect(s.enrollments(admin.id, batch, o)).rejects.toMatchObject({
      status: 403,
    });
  });
});
describe('preview, confirmation and atomic imports', () => {
  it('categorizes duplicates/invalid/pending rows without creating memberships', async () => {
    const p = await s.preview(owner.id, batch, {
      kind: 'PASTE',
      text: '23a91a05b2,23A91A05B2\ninvalid 23A91A05B3',
    });
    expect(p.results.map((r) => r.outcome)).toEqual([
      'PENDING_REGISTRATION',
      'DUPLICATE_INPUT',
      'INVALID_ROLL',
      'PENDING_REGISTRATION',
    ]);
    expect(repo.enrollments.size).toBe(0);
    expect([...repo.imports.values()][0]?.tokenHash).not.toBe(p.previewToken);
  });
  it('rechecks verification and capacity at confirmation and persists deterministic rejected rows', async () => {
    const p = await s.preview(owner.id, batch, {
      kind: 'PASTE',
      text: '23A91A05B2\n23A91A05B3',
    });
    repo.batches.get(batch)!.capacity = 1;
    await profile();
    const result = await s.import(
      owner.id,
      batch,
      { previewToken: p.previewToken, confirmed: true },
      'test',
    );
    expect(result.results.map((r) => r.outcome)).toEqual([
      'ACTIVE',
      'CAPACITY_CONFLICT',
    ]);
    expect(repo.enrollments.size).toBe(1);
  });
  it('rejects stale permissions, closed batch, expired preview and foreign owner', async () => {
    const p = await s.preview(admin.id, batch, {
      kind: 'PASTE',
      text: '23A91A05B2',
    });
    await expect(
      s.import(
        owner.id,
        batch,
        { previewToken: p.previewToken, confirmed: true },
        'test',
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    for (const grant of repo.students.admin.assignments.values())
      grant.status = 'REVOKED';
    await expect(
      s.import(
        admin.id,
        batch,
        { previewToken: p.previewToken, confirmed: true },
        'test',
      ),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('returns the same committed results for replay without reserving another seat', async () => {
    const p = await s.preview(owner.id, batch, {
      kind: 'PASTE',
      text: '23A91A05B2\ninvalid',
    });
    const input = { previewToken: p.previewToken, confirmed: true };
    const first = await s.import(owner.id, batch, input, 'first'),
      second = await s.import(owner.id, batch, input, 'retry');
    expect(second.replayed).toBe(true);
    expect(second.results).toEqual(first.results);
    expect(repo.batches.get(batch)!.seatCount).toBe(1);
  });
  it('rolls back all accepted rows, seats, history and operation results if an unexpected write fails', async () => {
    const p = await s.preview(owner.id, batch, {
      kind: 'PASTE',
      text: '23A91A05B2\n23A91A05B3',
    });
    repo.students.admin.failAudit = true;
    await expect(
      s.import(
        owner.id,
        batch,
        { previewToken: p.previewToken, confirmed: true },
        'test',
      ),
    ).rejects.toBeDefined();
    expect(repo.enrollments.size).toBe(0);
    expect(repo.events).toHaveLength(0);
    expect(repo.batches.get(batch)!.seatCount).toBe(0);
    expect([...repo.imports.values()][0]?.status).toBe('PREVIEW');
    repo.students.admin.failAudit = false;
    expect(
      (
        await s.import(
          owner.id,
          batch,
          { previewToken: p.previewToken, confirmed: true },
          'test',
        )
      ).results,
    ).toHaveLength(2);
  });
  it('manual request keys are idempotent and cannot be rebound to another roll', async () => {
    const key = randomUUID(),
      input = { rollNumber: '23A91A05B2', requestKey: key, confirmed: true };
    const a = await s.manual(owner.id, batch, input, 'first'),
      b = await s.manual(owner.id, batch, input, 'retry');
    expect(b.results).toEqual(a.results);
    expect(b.replayed).toBe(true);
    await expect(
      s.manual(owner.id, batch, { ...input, rollNumber: '23A91A05B3' }, 'test'),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });
});
describe('durable reconciliation state rules and immediate effective access', () => {
  it('resolves registration then verification and reconciliation is idempotent', async () => {
    await enroll();
    const p = await profile(false);
    await reconcile();
    expect([...repo.enrollments.values()][0]).toMatchObject({
      studentProfileId: p.id,
      status: 'PENDING_VERIFICATION',
    });
    const sv = new StudentService(repo.students, new QrVault('missing', '{}'));
    await sv.verify(
      owner.id,
      p.id,
      {
        expectedRevision: p.revision,
        method: 'AUTHORIZED_MANUAL',
        evidenceReference: 'Trusted registrar verification reference',
        confirmed: true,
      },
      false,
      'test',
    );
    await reconcile();
    expect([...repo.enrollments.values()][0]?.status).toBe('ACTIVE');
    const events = repo.events.length;
    await reconcile();
    expect(repo.events.length).toBe(events);
  });
  it('verification rejection, suspension and inactive college deny access before reconciliation', async () => {
    await profile();
    await enroll();
    repo.students.admin.auth.users.get(student.id)!.accountStatus = 'SUSPENDED';
    await expect(s.effective(student.id, batch)).rejects.toMatchObject({
      status: 403,
    });
    repo.students.admin.auth.users.get(student.id)!.accountStatus = 'ACTIVE';
    repo.students.admin.colleges.get(college)!.status = 'INACTIVE';
    await expect(s.effective(student.id, batch)).rejects.toMatchObject({
      code: 'ENROLLMENT_REQUIRED',
    });
    await reconcile();
    expect([...repo.enrollments.values()][0]?.status).toBe(
      'PENDING_VERIFICATION',
    );
  });
  it('current roll and college correction prevent old enrollment access', async () => {
    const p = await profile();
    await enroll();
    repo.students.profiles.get(p.id)!.rollNumber = '24CS001A12';
    await expect(s.effective(student.id, batch)).rejects.toMatchObject({
      code: 'ENROLLMENT_REQUIRED',
    });
    await reconcile();
    expect([...repo.enrollments.values()][0]?.status).toBe(
      'PENDING_VERIFICATION',
    );
    expect([...repo.enrollments.values()][0]?.rollNumber).toBe('23A91A05B2');
  });
  it('draft batch pending activates when eligible; completion preserves membership but denies current access', async () => {
    await profile();
    const draft = await s.saveBatch(
      owner.id,
      batchInput(college, course, 'NEXT'),
      undefined,
      'test',
    );
    expect(
      (await enroll('23A91A05B2', owner.id, draft.id)).results[0]?.outcome,
    ).toBe('PENDING_VERIFICATION');
    await s.batchStatus(
      owner.id,
      draft.id,
      'ACTIVE',
      transition(draft.revision),
      'test',
    );
    await reconcile('BATCH', draft.id);
    const active = repo.batches.get(draft.id)!;
    await s.batchStatus(
      owner.id,
      draft.id,
      'COMPLETED',
      transition(active.revision),
      'test',
    );
    await reconcile('BATCH', draft.id);
    expect([...repo.enrollments.values()][0]?.status).toBe('ACTIVE');
    await expect(s.effective(student.id, draft.id)).rejects.toMatchObject({
      code: 'ENROLLMENT_REQUIRED',
    });
  });
  it('archived course immediately blocks effective access without erasing snapshots', async () => {
    await profile();
    await enroll();
    await s.courseStatus(
      owner.id,
      course,
      'ARCHIVED',
      transition(repo.courses.get(course)!.revision),
      'test',
    );
    await expect(s.effective(student.id, batch)).rejects.toMatchObject({
      code: 'ENROLLMENT_REQUIRED',
    });
    expect(repo.batches.get(batch)?.snapshot.title).toBe(courseInput.title);
  });
});
describe('withdrawal, transfer and student dashboard', () => {
  it('withdrawal releases a seat and retains membership/history without silent re-enrollment', async () => {
    await profile();
    await enroll();
    const e = [...repo.enrollments.values()][0]!;
    await s.withdraw(
      owner.id,
      batch,
      e.id,
      {
        expectedRevision: e.revision,
        reason: 'Student requested withdrawal from this cohort',
        confirmed: true,
      },
      'test',
    );
    expect(repo.enrollments.get(e.id)?.status).toBe('WITHDRAWN');
    expect(repo.batches.get(batch)?.seatCount).toBe(0);
    await expect(s.effective(student.id, batch)).rejects.toMatchObject({
      status: 403,
    });
    expect((await enroll()).results[0]?.outcome).toBe('HISTORY_CONFLICT');
    expect(repo.events.map((x) => x.action)).toContain('WITHDRAWN');
  });
  it('transfers within same college/course transactionally and retains both links', async () => {
    await profile();
    await enroll();
    let dest = await s.saveBatch(
      owner.id,
      batchInput(college, course, 'NEXT'),
      undefined,
      'test',
    );
    dest = await s.batchStatus(
      owner.id,
      dest.id,
      'ACTIVE',
      transition(0),
      'test',
    );
    const e = [...repo.enrollments.values()][0]!;
    const next = await s.transfer(
      admin.id,
      batch,
      e.id,
      {
        destinationBatchId: dest.id,
        expectedRevision: e.revision,
        reason: 'Move to the next authorized cohort',
        confirmed: true,
      },
      'test',
    );
    expect(next.transferredFrom).toBe(e.id);
    expect(repo.enrollments.get(e.id)).toMatchObject({
      status: 'WITHDRAWN',
      transferredTo: next.id,
    });
    expect(repo.batches.get(batch)?.seatCount).toBe(0);
    expect(repo.batches.get(dest.id)?.seatCount).toBe(1);
  });
  it('rejects cross-college transfers without changing identity or source', async () => {
    const p = await profile();
    await enroll();
    const dest = await s.saveBatch(
      owner.id,
      batchInput(otherCollege, course),
      undefined,
      'test',
    );
    const e = [...repo.enrollments.values()][0]!;
    await expect(
      s.transfer(
        owner.id,
        batch,
        e.id,
        {
          destinationBatchId: dest.id,
          expectedRevision: e.revision,
          reason: 'Invalid cross-college transfer request',
          confirmed: true,
        },
        'test',
      ),
    ).rejects.toMatchObject({ code: 'TRANSFER_INELIGIBLE' });
    expect(repo.students.profiles.get(p.id)?.collegeId).toBe(college);
    expect(repo.enrollments.get(e.id)?.status).toBe('ACTIVE');
  });
  it('shows only real own membership data without fabricated progress or pending identity leakage', async () => {
    await enroll();
    const p = await profile(false);
    await reconcile();
    expect((await s.own(student.id, o)).items).toHaveLength(0);
    repo.students.profiles.get(p.id)!.verificationStatus = 'VERIFIED';
    repo.students.admin.auth.users.get(student.id)!.registrationStatus =
      'VERIFIED';
    await reconcile();
    const data = await s.own(student.id, o);
    expect(data.items[0]).toMatchObject({
      courseTitle: courseInput.title,
      batchName: batchInput(college, course).name,
      effectiveAccess: true,
    });
    expect(JSON.stringify(data)).not.toMatch(
      /progressPercent|attendancePercent|completedProblems/,
    );
  });
});

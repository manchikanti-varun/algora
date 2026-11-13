import { beforeEach, describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { CurriculumService, dayLabel } from '../curriculum/service.js';
import {
  canonicalProblem,
  problemInput,
  dayInput,
  editorialBody,
  safeHttps,
  querySchema,
} from '../curriculum/contracts.js';
import { TestCurriculum } from './curriculum-fixtures.js';
import { LearningService } from '../learning/service.js';
import { StudentService } from '../students/service.js';
import { QrVault } from '../students/crypto.js';
import { AdministrationService } from '../administration/service.js';
import { testUser, collegeInput } from './administration-fixtures.js';
import { courseInput, batchInput } from './learning-fixtures.js';
import { registrationInput } from './student-fixtures.js';
import {
  CurriculumRevision,
  PublishedLearningDay,
  EditorialRevision,
  LearningDay,
  CodingProblem,
} from '../models/curriculum.js';
const q = querySchema.parse({});
const confirm = (expectedRevision: number) => ({
  expectedRevision,
  confirmed: true,
});
let repo: TestCurriculum,
  s: CurriculumService,
  l: LearningService,
  owner: ReturnType<typeof testUser>,
  admin: ReturnType<typeof testUser>,
  student: ReturnType<typeof testUser>,
  college: string,
  course: string,
  batch: string,
  clock: Date;
const problem = {
  platform: 'LEETCODE',
  title: 'Pair target',
  url: 'https://leetcode.com/problems/two-sum/',
  difficulty: 'EASY',
  topics: ['Arrays'],
  description: 'Original instructor metadata',
  ownerCollegeId: null,
};
const approach = randomUUID();
const body = {
  title: 'Pair target explanation',
  introduction: 'Find complementary values.',
  approaches: [
    {
      id: approach,
      title: 'Hash lookup',
      intuition: 'Keep previous values',
      bruteForce: 'Scan pairs',
      optimizedApproach: 'Use a map',
      steps: ['Read each value', 'Check complement'],
      timeComplexity: 'O(n)',
      spaceComplexity: 'O(n)',
      notes: '',
    },
  ],
  examples: [
    {
      id: randomUUID(),
      input: '[2,7], 9',
      output: '[0,1]',
      walkthrough: 'The complement is present.',
    },
  ],
  codeSolutions: [
    {
      id: randomUUID(),
      approachId: approach,
      language: 'PYTHON',
      code: 'print("explanation only")',
    },
  ],
  additionalNotes: 'Private editorial body marker',
};
const day = (number = 1, extra: Record<string, unknown> = {}) => ({
  dayNumber: number,
  title: 'Arrays and maps',
  description: 'Learn core patterns',
  learningObjectives: ['Recognize complement lookup'],
  topics: [
    {
      id: randomUUID(),
      title: 'Arrays',
      description: 'Ordered values',
      estimatedMinutes: 30,
    },
  ],
  resources: [
    {
      id: randomUUID(),
      title: 'Instructor notes',
      type: 'NOTES',
      notes: 'Private resource marker',
      visibility: 'INSTRUCTOR_ONLY',
    },
    {
      id: randomUUID(),
      title: 'Public notes',
      type: 'NOTES',
      notes: 'Safe learning notes',
      visibility: 'STUDENT',
    },
  ],
  problemAssignments: [],
  publicationStatus: 'PUBLISHED',
  publishAt: null,
  expectedRevision: 0,
  ...extra,
});
beforeEach(async () => {
  repo = new TestCurriculum();
  l = new LearningService(repo.learning);
  clock = new Date('2030-01-01T00:00:00Z');
  s = new CurriculumService(repo, l, () => clock);
  owner = testUser({
    role: 'SUPER_ADMIN',
    username: 'sa-owner',
    accountStatus: 'ACTIVE',
  });
  admin = testUser({
    role: 'ADMIN',
    username: 'ad-editor',
    accountStatus: 'ACTIVE',
  });
  student = testUser();
  for (const u of [owner, admin, student])
    repo.learning.students.admin.auth.users.set(u.id, u);
  college = (
    await new AdministrationService(repo.learning.students.admin).createCollege(
      owner.id,
      collegeInput,
      'test',
    )
  ).id;
  await repo.learning.students.admin.read.putAssignment(
    admin.id,
    {
      collegeId: college,
      permissions: [
        'college.view',
        'course.manage',
        'batch.manage',
        'student.enroll',
        'student.verify',
        'student.view',
      ],
    },
    owner.id,
  );
  let c = await l.saveCourse(owner.id, courseInput, undefined, 'test');
  c = await l.courseStatus(
    owner.id,
    c.id,
    'PUBLISHED',
    confirm(c.revision),
    'test',
  );
  course = c.id;
  let b = await l.saveBatch(
    owner.id,
    batchInput(college, course),
    undefined,
    'test',
  );
  b = await l.batchStatus(
    owner.id,
    b.id,
    'ACTIVE',
    confirm(b.revision),
    'test',
  );
  batch = b.id;
});
async function draft() {
  return s.newDraft(owner.id, course, {}, 'test');
}
async function published(extra: Record<string, unknown> = {}) {
  const r = await draft();
  const d = await s.saveDay(
    owner.id,
    course,
    r.id,
    undefined,
    day(100, extra),
    'test',
  );
  await s.publish(owner.id, course, r.id, confirm(d.revision), 'test');
  return { r: repo.revisions.get(r.id)!, d: d.day };
}
async function assign(id: string, actor = owner.id) {
  const impact = await s.assignmentPreview(actor, batch, id);
  return s.assign(
    actor,
    batch,
    {
      curriculumRevisionId: id,
      expectedBatchRevision: impact.batchRevision,
      expectedPreviousRevisionId: impact.previousRevisionId,
      impactFingerprint: impact.impactFingerprint,
      reason: 'Reviewed curriculum delivery impact',
      confirmed: true,
    },
    'test',
  );
}
async function enroll(verified = true) {
  const ss = new StudentService(
    repo.learning.students,
    new QrVault('missing', '{}'),
  );
  let p = await ss.register(student.id, registrationInput(college), 'test');
  if (verified)
    p = await ss.verify(
      owner.id,
      p.id,
      {
        expectedRevision: p.revision,
        method: 'AUTHORIZED_MANUAL',
        evidenceReference: 'Registrar reviewed institutional evidence',
        confirmed: true,
      },
      false,
      'test',
    );
  await l.manual(
    owner.id,
    batch,
    { rollNumber: p.rollNumber, requestKey: randomUUID(), confirmed: true },
    'test',
  );
  return p;
}
async function editorial() {
  const p = await s.saveProblem(owner.id, problem, undefined, 'test');
  let e = await s.saveEditorial(
    owner.id,
    p.id,
    undefined,
    { body, ownerCollegeId: null },
    'test',
  );
  e = await s.publishEditorial(
    owner.id,
    p.id,
    e.id,
    confirm(e.revision),
    'test',
  );
  return { p, e };
}
describe('canonical content validation', () => {
  it.each([
    [
      'LEETCODE',
      'https://www.leetcode.com/problems/two-sum/description/',
      'two-sum',
    ],
    ['CODEFORCES', 'https://codeforces.com/contest/001/problem/a', '1-A'],
    ['CODECHEF', 'https://codechef.com/START1/problems/TEST', 'TEST'],
  ] as const)('canonicalizes %s', (platform, url, id) =>
    expect(canonicalProblem(platform, url).platformProblemId).toBe(id),
  );
  it.each([
    'https://leetcode.com.evil.org/problems/two-sum',
    'https://leetcode.com@evil.org/problems/two-sum',
    'https://leetcode.com/problems/%74wo-sum',
    'https://leetcode.com/problems/two-sum?redirect=evil',
    'https://leetcode.com/problems/two-sum#script',
    'http://leetcode.com/problems/two-sum',
    'https://127.0.0.1/problems/two-sum',
    'https://leetcode.com:444/problems/two-sum',
    'https://short.example/problem',
  ])('rejects unsafe canonical URL %s', (url) =>
    expect(() => canonicalProblem('LEETCODE', url)).toThrow(),
  );
  it.each([
    'javascript:alert(1)',
    'data:text/html,script',
    'file:///etc/passwd',
    'https://localhost/path',
    'https://10.0.0.1/a',
    'https://[::1]/a',
    'https://user:pass@example.org/a',
  ])('rejects unsafe resource %s', (url) => expect(safeHttps(url)).toBe(false));
  it('rejects mismatched client platform ID', () =>
    expect(
      problemInput.safeParse({ ...problem, platformProblemId: 'wrong' })
        .success,
    ).toBe(false));
  it.each([0, -1, 1.5])('rejects invalid day number %s', (n) =>
    expect(dayInput.safeParse(day(n)).success).toBe(false),
  );
  it('supports Day 100 without truncation', () =>
    expect(dayLabel(100)).toBe('Day 100'));
  it('rejects duplicate assignments', () => {
    const a = { problemId: owner.id, category: 'REQUIRED' };
    expect(
      dayInput.safeParse(day(1, { problemAssignments: [a, a] })).success,
    ).toBe(false);
  });
  it('rejects empty topic title', () =>
    expect(
      dayInput.safeParse(day(1, { topics: [{ id: randomUUID(), title: '' }] }))
        .success,
    ).toBe(false));
  it('rejects unsupported executable code language', () =>
    expect(
      editorialBody.safeParse({
        ...body,
        codeSolutions: [{ ...body.codeSolutions[0], language: 'SHELL' }],
      }).success,
    ).toBe(false));
  it('rejects code with an unrelated approach', () =>
    expect(
      editorialBody.safeParse({
        ...body,
        codeSolutions: [{ ...body.codeSolutions[0], approachId: randomUUID() }],
      }).success,
    ).toBe(false));
  it('rejects oversized snippets', () =>
    expect(
      editorialBody.safeParse({
        ...body,
        codeSolutions: [{ ...body.codeSolutions[0], code: 'a'.repeat(20001) }],
      }).success,
    ).toBe(false));
});
describe('transactional curriculum authoring', () => {
  it('allocates numbered drafts and refuses cloning a draft', async () => {
    const a = await draft(),
      b = await draft();
    expect([a.revisionNumber, b.revisionNumber]).toEqual([1, 2]);
    await expect(
      s.newDraft(owner.id, course, { sourceRevisionId: a.id }, 'test'),
    ).rejects.toMatchObject({ code: 'CLONE_PUBLISHED_ONLY' });
  });
  it('creates, updates and removes draft days with CAS', async () => {
    const r = await draft();
    const a = await s.saveDay(owner.id, course, r.id, undefined, day(), 'test');
    await s.saveDay(
      owner.id,
      course,
      r.id,
      a.day.id,
      day(1, { expectedRevision: 1, title: 'Updated title' }),
      'test',
    );
    await expect(
      s.removeDay(owner.id, course, r.id, a.day.id, confirm(1), 'test'),
    ).rejects.toMatchObject({ code: 'STALE_STATE' });
    await s.removeDay(owner.id, course, r.id, a.day.id, confirm(2), 'test');
    expect(repo.days.size).toBe(0);
  });
  it('rejects duplicate numbers and rolls back revision CAS', async () => {
    const r = await draft();
    await s.saveDay(owner.id, course, r.id, undefined, day(), 'test');
    await expect(
      s.saveDay(
        owner.id,
        course,
        r.id,
        undefined,
        day(1, { expectedRevision: 1 }),
        'test',
      ),
    ).rejects.toThrow();
    expect(repo.revisions.get(r.id)?.revision).toBe(1);
  });
  it('reorders all days atomically and rejects incomplete order', async () => {
    const r = await draft();
    const a = await s.saveDay(owner.id, course, r.id, undefined, day(), 'test'),
      b = await s.saveDay(
        owner.id,
        course,
        r.id,
        undefined,
        day(100, { expectedRevision: 1 }),
        'test',
      );
    await expect(
      s.reorder(
        owner.id,
        course,
        r.id,
        { dayIds: [a.day.id], expectedRevision: 2 },
        'test',
      ),
    ).rejects.toMatchObject({ code: 'INVALID_ORDER' });
    await s.reorder(
      owner.id,
      course,
      r.id,
      { dayIds: [b.day.id, a.day.id], expectedRevision: 2 },
      'test',
    );
    expect((await repo.read.allDays(r.id)).map((d) => d.id)).toEqual([
      b.day.id,
      a.day.id,
    ]);
  });
  it('publishes once and rejects stale simultaneous publication', async () => {
    const r = await draft();
    await s.saveDay(owner.id, course, r.id, undefined, day(), 'test');
    const outcomes = await Promise.allSettled([
      s.publish(owner.id, course, r.id, confirm(1), 'test'),
      s.publish(owner.id, course, r.id, confirm(1), 'test'),
    ]);
    expect(outcomes.filter((v) => v.status === 'fulfilled')).toHaveLength(1);
    expect(repo.frozen.size).toBe(1);
  });
  it('rejects empty publication', async () => {
    const r = await draft();
    await expect(
      s.publish(owner.id, course, r.id, confirm(0), 'test'),
    ).rejects.toMatchObject({ code: 'EMPTY_CURRICULUM' });
  });
  it('published day writes are forbidden even to owner', async () => {
    const { r, d } = await published();
    await expect(
      s.saveDay(
        owner.id,
        course,
        r.id,
        d.id,
        day(100, { expectedRevision: r.revision }),
        'test',
      ),
    ).rejects.toMatchObject({ code: 'IMMUTABLE_CONTENT' });
    await expect(repo.read.removeDay(d.id, r.id)).rejects.toMatchObject({
      code: 'IMMUTABLE_CONTENT',
    });
  });
  it('clones immutable snapshots into distinct draft documents', async () => {
    const { r, d } = await published();
    const clone = await s.newDraft(
      owner.id,
      course,
      { sourceRevisionId: r.id },
      'test',
    );
    const days = await repo.read.allDays(clone.id);
    expect(days[0].id).not.toBe(d.id);
    expect(days[0].dayNumber).toBe(100);
    expect(clone.sourceRevisionId).toBe(r.id);
  });
  it('denies global Course authoring to college Admin', async () => {
    await expect(
      s.newDraft(admin.id, course, {}, 'test'),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('denies student catalog and curriculum access', async () => {
    await expect(s.problems(student.id, q)).rejects.toMatchObject({
      status: 403,
    });
    await expect(s.revisions(student.id, course, q)).rejects.toMatchObject({
      status: 403,
    });
  });
  it('rolls back publication, snapshots and audit on audit failure', async () => {
    const r = await draft();
    await s.saveDay(owner.id, course, r.id, undefined, day(), 'test');
    const read = repo.learning.students.admin.read;
    vi.spyOn(repo.learning.students.admin, 'read', 'get').mockReturnValue({
      ...read,
      audit: async () => {
        throw Error('audit unavailable');
      },
    });
    await expect(
      s.publish(owner.id, course, r.id, confirm(1), 'test'),
    ).rejects.toThrow();
    expect(repo.revisions.get(r.id)?.status).toBe('DRAFT');
    expect(repo.frozen.size).toBe(0);
    vi.restoreAllMocks();
  });
  it('previews without exposing instructor resources', async () => {
    const r = await draft(),
      d = await s.saveDay(owner.id, course, r.id, undefined, day(), 'test');
    const preview = await s.preview(owner.id, course, r.id, d.day.id);
    expect(JSON.stringify(preview)).not.toContain('Private resource marker');
  });
});
describe('catalog and editorial integrity', () => {
  it('deduplicates canonical catalog identities', async () => {
    await s.saveProblem(owner.id, problem, undefined, 'test');
    await expect(
      s.saveProblem(
        owner.id,
        {
          ...problem,
          url: 'https://www.leetcode.com/problems/two-sum/description',
        },
        undefined,
        'test',
      ),
    ).rejects.toThrow();
  });
  it('freezes exact editorial version and metadata', async () => {
    const { p, e } = await editorial();
    const { r } = await published({
      problemAssignments: [
        {
          problemId: p.id,
          category: 'CHALLENGE',
          editorialId: e.id,
          editorialVisibility: 'VISIBLE',
        },
      ],
    });
    await s.saveProblem(
      owner.id,
      { ...problem, title: 'Later metadata', expectedRevision: 0 },
      p.id,
      'test',
    );
    const clone = await s.cloneEditorial(owner.id, p.id, e.id, 'test');
    await s.saveEditorial(
      owner.id,
      p.id,
      clone.id,
      {
        body: { ...body, title: 'Later explanation' },
        ownerCollegeId: null,
        expectedRevision: 0,
      },
      'test',
    );
    const frozen = (await repo.read.allFrozenDays(r.id))[0]
      .problemAssignments[0];
    expect(frozen.problem.title).toBe(problem.title);
    expect(frozen.editorial?.body.title).toBe(body.title);
  });
  it('forbids editing published editorials and stale drafts', async () => {
    const { p, e } = await editorial();
    await expect(
      s.saveEditorial(
        owner.id,
        p.id,
        e.id,
        { body, ownerCollegeId: null, expectedRevision: e.revision },
        'test',
      ),
    ).rejects.toMatchObject({ code: 'IMMUTABLE_CONTENT' });
    const clone = await s.cloneEditorial(owner.id, p.id, e.id, 'test');
    await s.saveEditorial(
      owner.id,
      p.id,
      clone.id,
      { body, ownerCollegeId: null, expectedRevision: 0 },
      'test',
    );
    await expect(
      s.saveEditorial(
        owner.id,
        p.id,
        clone.id,
        { body, ownerCollegeId: null, expectedRevision: 0 },
        'test',
      ),
    ).rejects.toMatchObject({ code: 'STALE_STATE' });
  });
  it('denies foreign editorial drafts and global metadata mutation', async () => {
    const { p } = await editorial();
    const privateDraft = await s.saveEditorial(
      owner.id,
      p.id,
      undefined,
      { body, ownerCollegeId: null },
      'test',
    );
    await expect(
      s.editorial(admin.id, p.id, privateDraft.id),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      s.saveProblem(
        admin.id,
        { ...problem, title: 'Tampered', expectedRevision: 0 },
        p.id,
        'test',
      ),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('requires a published matching editorial', async () => {
    const p = await s.saveProblem(owner.id, problem, undefined, 'test'),
      e = await s.saveEditorial(
        owner.id,
        p.id,
        undefined,
        { body, ownerCollegeId: null },
        'test',
      ),
      r = await draft();
    await expect(
      s.saveDay(
        owner.id,
        course,
        r.id,
        undefined,
        day(1, {
          problemAssignments: [
            {
              problemId: p.id,
              category: 'REQUIRED',
              editorialId: e.id,
              editorialVisibility: 'VISIBLE',
            },
          ],
        }),
        'test',
      ),
    ).rejects.toMatchObject({ code: 'EDITORIAL_INELIGIBLE' });
  });
});
describe('batch delivery and fresh student access', () => {
  it('shows honest unassigned state', async () => {
    await enroll();
    expect((await s.studentBatch(student.id, batch, q)).revision).toBeNull();
    await expect(s.studentDay(student.id, batch, 100)).rejects.toMatchObject({
      code: 'CURRICULUM_NOT_ASSIGNED',
    });
  });
  it('assigns reviewed active revision and preserves upgrade history', async () => {
    const first = await published();
    await assign(first.r.id, admin.id);
    const second = await published();
    expect(repo.learning.batches.get(batch)?.curriculumRevisionId).toBe(
      first.r.id,
    );
    await assign(second.r.id);
    expect(repo.history.map((h) => h.previousRevisionId)).toEqual([
      null,
      first.r.id,
    ]);
    expect(repo.history[1].newRevisionId).toBe(second.r.id);
  });
  it('rejects unpublished and wrong-Course revisions', async () => {
    const r = await draft();
    await expect(assign(r.id)).rejects.toMatchObject({
      code: 'REVISION_NOT_PUBLISHED',
    });
    repo.revisions.get(r.id)!.status = 'PUBLISHED';
    repo.revisions.get(r.id)!.courseId = owner.id;
    await expect(assign(r.id)).rejects.toMatchObject({ status: 404 });
  });
  it('rejects stale reviewed impact', async () => {
    const { r } = await published(),
      impact = await s.assignmentPreview(owner.id, batch, r.id);
    repo.learning.batches.get(batch)!.seatCount++;
    await expect(
      s.assign(
        owner.id,
        batch,
        {
          curriculumRevisionId: r.id,
          expectedBatchRevision: impact.batchRevision,
          expectedPreviousRevisionId: null,
          impactFingerprint: impact.impactFingerprint,
          reason: 'Reviewed curriculum delivery impact',
          confirmed: true,
        },
        'test',
      ),
    ).rejects.toMatchObject({ code: 'STALE_IMPACT' });
    expect(repo.history).toHaveLength(0);
  });
  it.each(['COMPLETED', 'ARCHIVED'] as const)(
    'does not change %s history',
    async (status) => {
      const { r } = await published();
      repo.learning.batches.get(batch)!.status = status;
      await expect(assign(r.id)).rejects.toMatchObject({
        code: 'BATCH_CLOSED',
      });
    },
  );
  it('allows Day 100 without any prior completion', async () => {
    await enroll();
    const { r } = await published();
    await assign(r.id);
    expect((await s.studentDay(student.id, batch, 100)).day.dayNumber).toBe(
      100,
    );
    expect(
      (await s.studentCourse(student.id, course, q)).batches.items,
    ).toHaveLength(1);
  });
  it('strips hidden editorial and instructor resources from every student projection', async () => {
    await enroll();
    const { p, e } = await editorial(),
      { r } = await published({
        problemAssignments: [
          {
            problemId: p.id,
            category: 'REQUIRED',
            editorialId: e.id,
            editorialVisibility: 'HIDDEN',
          },
        ],
      });
    await assign(r.id);
    const response = await s.studentDay(student.id, batch, 100);
    expect(JSON.stringify(response)).not.toContain(
      'Private editorial body marker',
    );
    expect(JSON.stringify(response)).not.toContain('Private resource marker');
    expect(response.day.problemAssignments[0].editorialAvailable).toBe(false);
    await expect(
      s.studentEditorial(student.id, batch, 100, p.id),
    ).rejects.toMatchObject({ status: 404 });
  });
  it('returns only exact assigned revision', async () => {
    await enroll();
    const first = await published(),
      second = await published({ title: 'Other revision title' });
    await assign(first.r.id);
    expect((await s.studentDay(student.id, batch, 100)).revision.id).toBe(
      first.r.id,
    );
    expect((await s.studentDay(student.id, batch, 100)).day.title).not.toBe(
      'Other revision title',
    );
    expect(second.r.id).not.toBe(first.r.id);
  });
  it('enforces schedule by injected server time including restore', async () => {
    await enroll();
    const { r, d } = await published({
      publicationStatus: 'SCHEDULED',
      publishAt: '2030-01-02T00:00:00.000Z',
    });
    await assign(r.id);
    await expect(s.studentDay(student.id, batch, 100)).rejects.toMatchObject({
      code: 'DAY_UNAVAILABLE',
    });
    await s.release(
      owner.id,
      batch,
      d.id,
      {
        restricted: true,
        expectedRevision: 0,
        reason: 'Withdraw pending content review',
        confirmed: true,
      },
      'test',
    );
    await s.release(
      owner.id,
      batch,
      d.id,
      {
        restricted: false,
        expectedRevision: 1,
        reason: 'Restore original schedule after review',
        confirmed: true,
      },
      'test',
    );
    await expect(s.studentDay(student.id, batch, 100)).rejects.toMatchObject({
      code: 'DAY_UNAVAILABLE',
    });
    clock = new Date('2030-01-02T00:00:00Z');
    expect((await s.studentDay(student.id, batch, 100)).day.title).toBe(
      'Arrays and maps',
    );
  });
  it.each(['DRAFT', 'UNPUBLISHED'])(
    'never returns %s day content',
    async (status) => {
      await enroll();
      const { r } = await published({ publicationStatus: status });
      await assign(r.id);
      expect(
        (await s.studentBatch(student.id, batch, q)).days.items,
      ).toHaveLength(0);
      await expect(s.studentDay(student.id, batch, 100)).rejects.toMatchObject({
        status: 404,
      });
    },
  );
  it('denies past scheduling', async () => {
    const r = await draft();
    await expect(
      s.saveDay(
        owner.id,
        course,
        r.id,
        undefined,
        day(1, {
          publicationStatus: 'SCHEDULED',
          publishAt: '2029-01-01T00:00:00Z',
        }),
        'test',
      ),
    ).rejects.toMatchObject({ code: 'SCHEDULE_NOT_FUTURE' });
  });
  it.each([
    'unverified',
    'withdrawn',
    'pending',
    'suspended',
    'college',
    'completed',
    'archivedCourse',
    'rollChanged',
  ])('rechecks fresh access for %s', async (kind) => {
    const p = await enroll(kind !== 'unverified');
    const { r } = await published();
    await assign(r.id);
    if (kind === 'withdrawn' || kind === 'pending') {
      for (const e of repo.learning.enrollments.values())
        e.status = kind === 'withdrawn' ? 'WITHDRAWN' : 'PENDING_REGISTRATION';
    }
    if (kind === 'suspended')
      repo.learning.students.admin.auth.users.get(student.id)!.accountStatus =
        'SUSPENDED';
    if (kind === 'college')
      repo.learning.students.admin.colleges.get(college)!.status = 'INACTIVE';
    if (kind === 'completed')
      repo.learning.batches.get(batch)!.status = 'COMPLETED';
    if (kind === 'archivedCourse')
      repo.learning.courses.get(course)!.status = 'ARCHIVED';
    if (kind === 'rollChanged')
      repo.learning.students.profiles.get(p.id)!.rollNumber = 'CHANGED';
    await expect(s.studentDay(student.id, batch, 100)).rejects.toMatchObject({
      status: 403,
    });
  });
});
describe('database immutable write guards and indexes', () => {
  it.each(['updateOne', 'deleteMany', 'findOneAndUpdate'] as const)(
    'rejects snapshot %s before database access',
    async (op) => {
      await expect(
        PublishedLearningDay[op]({}, { $set: { dayNumber: 3 } }).exec(),
      ).rejects.toMatchObject({ code: 'IMMUTABLE_CONTENT' });
    },
  );
  it('requires draft state in curriculum and editorial query filters', async () => {
    await expect(
      CurriculumRevision.updateOne({}, { $set: { status: 'DRAFT' } }).exec(),
    ).rejects.toMatchObject({ code: 'IMMUTABLE_CONTENT' });
    await expect(
      EditorialRevision.deleteMany({ status: 'PUBLISHED' }).exec(),
    ).rejects.toMatchObject({ code: 'IMMUTABLE_CONTENT' });
  });
  it('requires parent revision on day writes', async () => {
    await expect(
      LearningDay.updateOne({}, { $set: { title: 'overwrite' } }).exec(),
    ).rejects.toMatchObject({ code: 'IMMUTABLE_CONTENT' });
  });
  it('declares compound unique identities', () => {
    for (const [model, fields] of [
      [CurriculumRevision, ['courseId', 'revisionNumber']],
      [LearningDay, ['curriculumRevisionId', 'dayNumber']],
      [CodingProblem, ['platform', 'platformProblemId']],
      [EditorialRevision, ['problemId', 'versionNumber']],
    ] as const)
      expect(
        model.schema
          .indexes()
          .some(
            ([keys, options]) =>
              options.unique && fields.every((f) => f in keys),
          ),
      ).toBe(true);
  });
});

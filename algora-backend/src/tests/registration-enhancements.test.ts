import { beforeEach, it, expect } from 'vitest';
import { setupCoding } from './coding-fixtures.js';
import { testUser, newId } from './administration-fixtures.js';
import {
  registerSchema,
  studentListSchema,
  editSchema,
} from '../students/contracts.js';
import { registrationInput } from './student-fixtures.js';
import { AttendanceService } from '../attendance/service.js';
import { StudentProfile } from '../models/student-profile.js';
let f: Awaited<ReturnType<typeof setupCoding>>;
beforeEach(async () => {
  f = await setupCoding();
});
it('reuses an ACTIVE-only searchable alphabetical minimal registration directory', async () => {
  const map = f.repo.curriculum.learning.students.admin.colleges,
    original = map.get(f.college)!;
  for (const [name, status] of [
    ['Zulu Academy', 'ACTIVE'],
    ['Alpha Academy', 'ACTIVE'],
    ['Hidden Academy', 'INACTIVE'],
    ['Archived Academy', 'ARCHIVED'],
  ] as const) {
    const id = newId();
    map.set(id, {
      ...structuredClone(original),
      id,
      name,
      code: name.split(' ')[0]!.toUpperCase(),
      status,
    });
  }
  const options = await f.students.options(
    f.student.user.id,
    studentListSchema.parse({ search: 'Academy', pageSize: 2 }),
  );
  expect(options.colleges.items.map((c) => c.name)).toEqual([
    'Alpha Academy',
    'Zulu Academy',
  ]);
  expect(Object.keys(options.colleges.items[0]!)).toEqual([
    'id',
    'name',
    'code',
  ]);
  expect(options.colleges.total).toBe(2);
  const search = await f.students.options(
    f.student.user.id,
    studentListSchema.parse({ search: 'Zulu' }),
  );
  expect(search.colleges.items).toHaveLength(1);
});
it.each([1, 2, 3, 4])('uses the existing canonical numeric Year %s', (year) => {
  expect(
    registerSchema.parse({ ...registrationInput(f.college), yearOfStudy: year })
      .yearOfStudy,
  ).toBe(year);
});
it.each([undefined, null, 0, -1, 5, 1.5, '1', 'First Year', true])(
  'rejects invalid/missing new-registration year %j',
  (year) => {
    expect(
      registerSchema.safeParse({
        ...registrationInput(f.college),
        yearOfStudy: year,
      }).success,
    ).toBe(false);
  },
);
it('keeps legacy missing-year profiles readable without assigning a default', async () => {
  delete f.repo.curriculum.learning.students.profiles.get(f.student.profile.id)!
    .yearOfStudy;
  const me = await f.students.me(f.student.user.id);
  expect(me.profile.yearOfStudy).toBeUndefined();
  expect(
    (await f.students.detail(f.owner.id, f.student.profile.id)).profile
      .yearOfStudy,
  ).toBeUndefined();
  expect(StudentProfile.schema.path('yearOfStudy').options.required).not.toBe(
    true,
  );
});
it('rejects forged College relationships and does not create Colleges', async () => {
  const user = f.repo.curriculum.learning.students.admin.auth.users.get(
    f.student.user.id,
  )!;
  const size = f.repo.curriculum.learning.students.admin.colleges.size;
  expect(
    registerSchema.safeParse({
      ...registrationInput(f.college),
      collegeId: 'not an id',
    }).success,
  ).toBe(false);
  expect(
    editSchema.safeParse({
      ...registrationInput(f.college),
      expectedRevision: 0,
      collegeId: newId(),
    }).success,
  ).toBe(false);
  expect(f.repo.curriculum.learning.students.admin.colleges.size).toBe(size);
  expect(user.registrationStatus).toBe('VERIFIED');
});
it('year-only reviewed updates preserve verification, QR, enrollment, attendance, coding binding and evidence', async () => {
  const a = await f.link();
  await f.verify(a.id);
  await f.queue();
  await f.service.processOne();
  const session = await f.session();
  await new AttendanceService(f.attendanceRepo, f.learning).scan(
    f.admin.id,
    f.batch,
    session.id,
    { credential: f.student.token },
    'test',
  );
  await f.service.repo.ensureReady();
  await f.repo.curriculum.learning.students.admin.read.putAssignment(
    f.admin.id,
    {
      collegeId: f.college,
      permissions: ['college.view', 'attendance.manage'],
    },
    f.owner.id,
  );
  const p = f.repo.curriculum.learning.students.profiles.get(
    f.student.profile.id,
  )!;
  const before = {
    attendance: structuredClone(f.attendanceRepo.rows),
    profile: structuredClone(p),
    enrollments: structuredClone(f.repo.curriculum.learning.enrollments),
    credentials: structuredClone(
      f.repo.curriculum.learning.students.credentials,
    ),
    evidence: structuredClone(f.repo.evidence),
    accounts: structuredClone(f.repo.accounts),
  };
  const request = await f.students.requestCorrection(
    f.student.user.id,
    {
      expectedRevision: p.revision,
      requestedChanges: {
        yearOfStudy: 4,
        fullName: p.fullName,
        collegeId: p.collegeId,
      },
      reason: 'Institution confirmed academic year advancement',
    },
    'test',
  );
  await f.students.review(
    f.owner.id,
    request.id,
    {
      expectedRevision: p.revision,
      reviewNote: 'Confirmed year against institutional academic records',
      confirmed: true,
    },
    true,
    'test',
  );
  const after = f.repo.curriculum.learning.students.profiles.get(p.id)!;
  expect(after.yearOfStudy).toBe(4);
  expect(after.verificationStatus).toBe('VERIFIED');
  expect(after.studentUsername).toBe(before.profile.studentUsername);
  expect(after.rollNumber).toBe(before.profile.rollNumber);
  expect(after.qrCredentialVersion).toBe(before.profile.qrCredentialVersion);
  expect(f.repo.curriculum.learning.students.credentials).toEqual(
    before.credentials,
  );
  expect(f.repo.curriculum.learning.enrollments).toEqual(before.enrollments);
  expect(f.repo.evidence).toEqual(before.evidence);
  expect(f.repo.accounts).toEqual(before.accounts);
  expect(
    (await f.service.dashboard(f.student.user.id, f.batch, {})).summary.solved,
  ).toBe(1);
  expect(f.attendanceRepo.rows).toEqual(before.attendance);
  expect(session.id).toBeTruthy();
});
it('a missing year can be completed through the existing scoped correction workflow', async () => {
  const p = f.repo.curriculum.learning.students.profiles.get(
    f.student.profile.id,
  )!;
  delete p.yearOfStudy;
  const request = await f.students.requestCorrection(
    f.student.user.id,
    {
      expectedRevision: p.revision,
      requestedChanges: { yearOfStudy: 2 },
      reason: 'Complete previously missing academic year information',
    },
    'test',
  );
  await expect(
    f.students.review(
      f.admin.id,
      request.id,
      {
        expectedRevision: p.revision,
        reviewNote: 'Reviewed academic information',
        confirmed: true,
      },
      true,
      'test',
    ),
  ).rejects.toMatchObject({ code: 'COLLEGE_FORBIDDEN' });
  await f.students.review(
    f.owner.id,
    request.id,
    {
      expectedRevision: p.revision,
      reviewNote: 'Reviewed institutional academic information',
      confirmed: true,
    },
    true,
    'test',
  );
  expect((await f.students.me(f.student.user.id)).profile.yearOfStudy).toBe(2);
});

it.each(['INACTIVE', 'ARCHIVED'] as const)(
  'rejects actual registration against an existing %s College',
  async (status) => {
    const map = f.repo.curriculum.learning.students.admin.colleges,
      id = newId();
    map.set(id, { ...structuredClone(map.get(f.college)!), id, status });
    const u = testUser();
    f.repo.curriculum.learning.students.admin.auth.users.set(u.id, u);
    await expect(
      f.students.register(
        u.id,
        { ...registrationInput(id), confirmed: true },
        'test',
      ),
    ).rejects.toMatchObject({ code: 'COLLEGE_UNAVAILABLE' });
    expect(await f.repo.curriculum.learning.students.read.own(u.id)).toBeNull();
  },
);
it('persists the existing selected College reference and never creates a duplicate institution', async () => {
  const u = testUser(),
    map = f.repo.curriculum.learning.students.admin.colleges,
    size = map.size;
  f.repo.curriculum.learning.students.admin.auth.users.set(u.id, u);
  const p = await f.students.register(
    u.id,
    { ...registrationInput(f.college), yearOfStudy: 3, confirmed: true },
    'test',
  );
  expect(p.collegeId).toBe(f.college);
  expect(p.yearOfStudy).toBe(3);
  expect(map.size).toBe(size);
  expect(p.verificationStatus).toBe('PENDING_VERIFICATION');
});
it('rejects a valid-format but nonexistent College ID without creating a profile', async () => {
  const u = testUser();
  f.repo.curriculum.learning.students.admin.auth.users.set(u.id, u);
  await expect(
    f.students.register(
      u.id,
      { ...registrationInput(newId()), confirmed: true },
      'test',
    ),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  expect(await f.repo.curriculum.learning.students.read.own(u.id)).toBeNull();
});

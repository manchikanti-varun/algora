import { beforeEach, it, expect, vi } from 'vitest';
import request from 'supertest';
import { setupAnalytics } from './analytics-fixtures.js';
import { analyticsQuery } from '../analytics/contracts.js';
import { attendanceMetrics, reasons } from '../analytics/calculations.js';
import { reportMetrics } from '../coding/reports.js';
import { AttendanceService } from '../attendance/service.js';
import { createApp } from '../app.js';
import { SessionService } from '../auth/session-service.js';
import { identity } from './auth-fixtures.js';
import { newId } from './administration-fixtures.js';
let f: Awaited<ReturnType<typeof setupAnalytics>>;
beforeEach(async () => {
  f = await setupAnalytics();
});
const batch = () => f.analytics.batch(f.owner.id, f.batch, {});
async function finalized(
  type: 'MORNING' | 'AFTERNOON' = 'MORNING',
  present = false,
) {
  const s = await f.session(type);
  const a = new AttendanceService(f.attendanceRepo, f.learning);
  if (present)
    await a.scan(
      f.admin.id,
      f.batch,
      s.id,
      { credential: f.student.token },
      'test',
    );
  const d = await a.detail(f.admin.id, f.batch, s.id);
  await a.transition(
    f.admin.id,
    f.batch,
    s.id,
    'close',
    {
      expectedRevision: d.session.revision,
      confirmed: true,
      reason: 'Close session after teaching finishes',
    },
    'test',
  );
  const closed = await a.detail(f.admin.id, f.batch, s.id);
  await a.transition(
    f.admin.id,
    f.batch,
    s.id,
    'finalize',
    {
      expectedRevision: closed.session.revision,
      confirmed: true,
      reason: 'Finalize authorized attendance session',
    },
    'test',
  );
  return s;
}
it('reconciles Batch and platform totals with shared Phase 8 report data', async () => {
  const v = await batch(),
    data = await f.service.reportData(f.owner.id, f.batch, {});
  expect(v.summary.coding).toEqual(reportMetrics(data.rows));
  expect(v.summary.eligibleStudents).toBe(1);
  expect(v.platforms[0]!.coding).toEqual(v.summary.coding);
  expect(v.summary.coding.unavailable).toBe(1);
});
it('uses verified accepted evidence and exact completion denominators', async () => {
  const a = await f.link();
  await f.verify(a.id);
  await f.queue();
  await f.service.processOne();
  const v = await batch();
  expect(v.summary.coding).toMatchObject({
    assigned: 1,
    solved: 1,
    attempted: 0,
    completion: 1,
    coverage: 1,
    unavailable: 0,
  });
});
it('keeps pending Morning and Afternoon separate and never invents absence', async () => {
  await f.session('MORNING');
  await f.session('AFTERNOON');
  const v = await batch();
  expect(v.sessions).toHaveLength(2);
  expect(v.sessions.map((s) => s.absent)).toEqual([null, null]);
  expect(v.summary.attendance).toMatchObject({
    eligible: 0,
    absent: 0,
    percentage: null,
  });
  expect(v.summary.pendingSessions).toBe(2);
});
it('counts finalized Student session opportunities across both session types', async () => {
  await finalized('MORNING', true);
  await finalized('AFTERNOON', false);
  const v = await batch();
  expect(v.summary.attendance).toMatchObject({
    eligible: 2,
    present: 1,
    absent: 1,
    percentage: 0.5,
  });
  expect(v.days[0]!.morning.percentage).toBe(1);
  expect(v.days[0]!.afternoon.percentage).toBe(0);
});
it('reflects authoritative corrections including EXCUSED in the Phase 9 denominator', async () => {
  await finalized();
  const row = [...f.attendanceRepo.rows.values()][0]!;
  row.status = 'EXCUSED';
  row.source = 'ADMIN_CORRECTION';
  const v = await batch();
  expect(v.summary.attendance).toMatchObject({
    eligible: 1,
    excused: 1,
    corrected: 1,
    percentage: 0,
  });
  expect(v.attendanceMatrix.items[0]!.marks[0]!.corrected).toBe(true);
});
it('retains finalized snapshot history after withdrawal', async () => {
  await finalized();
  const e = [...f.repo.curriculum.learning.enrollments.values()][0]!;
  e.status = 'WITHDRAWN';
  expect((await batch()).summary.attendance.eligible).toBe(1);
});
it('flags repeated absences from two finalized session marks', async () => {
  await finalized('MORNING');
  await finalized('AFTERNOON');
  expect(
    (await batch()).followUp.items.some(
      (r) => r.reason === 'REPEATED_ABSENCE' && r.absent === 2,
    ),
  ).toBe(true);
});
it('does not flag low completion with unavailable verification', async () => {
  for (let i = 0; i < 5; i++) {
    const d = structuredClone(f.frozen);
    d.id = newId();
    d.dayNumber = 101 + i;
    f.repo.curriculum.frozen.set(d.id, d);
  }
  const v = await batch();
  expect(v.summary.coding.coverage).toBe(0);
  expect(v.followUp.items.some((r) => r.reason === 'LOW_COMPLETION')).toBe(
    false,
  );
});
it('keeps published empty Learning Days visible with N/A completion', async () => {
  f.frozen.problemAssignments = [];
  const v = await batch();
  expect(v.days[0]!.coding.completion).toBeNull();
  expect(v.days[0]!.eligibleStudents).toBe(1);
  expect(v.summary.coding.assigned).toBe(0);
});
it('reads pinned revision and excludes restricted Days', async () => {
  f.repo.curriculum.releases.set('release', {
    id: newId(),
    batchId: f.batch,
    curriculumRevisionId: f.revision,
    revision: 0,
    dayId: f.frozen.id,
    restricted: true,
    reason: 'Instructor restricted release',
    updatedBy: f.owner.id,
    updatedAt: f.getNow().toISOString(),
  });
  const v = await batch();
  expect(v.days).toHaveLength(0);
  expect(v.summary.coding.assigned).toBe(0);
});
it('returns full totals independently of paginated student rows for a 120 Student Batch', async () => {
  for (let i = 1; i < 120; i++) await f.addStudent();
  for (let i = 1; i < 100; i++) {
    const day = structuredClone(f.frozen);
    day.id = newId();
    day.dayNumber = 100 + i;
    f.repo.curriculum.frozen.set(day.id, day);
  }
  await finalized('MORNING');
  await finalized('AFTERNOON');
  const v = await f.analytics.batch(f.owner.id, f.batch, {
    page: 3,
    pageSize: 50,
  });
  expect(v.students.total).toBe(120);
  expect(v.students.items).toHaveLength(20);
  expect(v.summary.coding.assigned).toBe(12000);
  expect(v.summary.attendance).toMatchObject({
    eligible: 240,
    absent: 240,
    present: 0,
  });
  expect(v.summary.coding.unavailable).toBe(12000);
  expect(v.summary.eligibleStudents).toBe(120);
}, 60000);
it('supports Year, search, Day and platform filters with stable pagination', async () => {
  const added = await f.addStudent();
  f.repo.curriculum.learning.students.profiles.get(
    added.profile.id,
  )!.yearOfStudy = 4;
  const v = await f.analytics.batch(f.owner.id, f.batch, {
    year: 4,
    search: added.profile.rollNumber,
    day: 100,
    platform: 'CODEFORCES',
    sort: 'name',
    direction: 'desc',
    pageSize: 1,
  });
  expect(v.students.items.map((s) => s.id)).toEqual([added.profile.id]);
  expect(v.summary.coding.assigned).toBe(1);
});
it('produces platform overview totals and College comparison from real fixture records', async () => {
  const v = await f.analytics.overview(f.owner.id, {}, true);
  expect(v.summary).toMatchObject({
    colleges: 1,
    registeredStudents: 1,
    verifiedStudents: 1,
    activeBatches: 1,
    enrollments: 1,
    assignedProblems: 1,
  });
  expect(v.colleges.items[0]!.coding).toEqual(v.summary.coding);
});
it('rejects Admin analytics without all required current permissions', async () => {
  await expect(f.analytics.overview(f.admin.id, {})).rejects.toMatchObject({
    status: 403,
  });
});
async function grant() {
  await f.repo.curriculum.learning.students.admin.read.putAssignment(
    f.admin.id,
    {
      collegeId: f.college,
      permissions: [
        'college.view',
        'attendance.manage',
        'progress.view',
        'student.view',
      ],
    },
    f.owner.id,
  );
}
it('permits authorized College scope and denies forged Colleges', async () => {
  await grant();
  expect((await f.analytics.overview(f.admin.id, {})).colleges.total).toBe(1);
  await expect(
    f.analytics.overview(f.admin.id, { collegeId: newId() }),
  ).rejects.toMatchObject({ status: 403 });
});
it('revoked grants deny direct Batch analytics', async () => {
  await grant();
  for (const g of f.repo.curriculum.learning.students.admin.assignments.values())
    g.status = 'REVOKED';
  await expect(
    f.analytics.batch(f.admin.id, f.batch, {}),
  ).rejects.toMatchObject({ status: 403 });
});
it('inactive Colleges deny Admin analytics', async () => {
  await grant();
  f.repo.curriculum.learning.students.admin.colleges.get(f.college)!.status =
    'INACTIVE';
  await expect(f.analytics.overview(f.admin.id, {})).rejects.toMatchObject({
    status: 403,
  });
});
it('suspended users cannot read even global analytics', async () => {
  f.repo.curriculum.learning.students.admin.auth.users.get(
    f.owner.id,
  )!.accountStatus = 'SUSPENDED';
  await expect(f.analytics.overview(f.owner.id, {})).rejects.toMatchObject({
    status: 403,
  });
});
it('enforces self only personal analytics and excludes another Student data', async () => {
  const other = await f.addStudent();
  const v = await f.analytics.personal(f.student.user.id, {});
  expect(v.summary.coding.assigned).toBe(1);
  expect(JSON.stringify(v)).not.toContain(other.profile.id);
  await expect(
    f.analytics.personal(f.student.user.id, {
      studentProfileId: other.profile.id,
    }),
  ).rejects.toBeDefined();
  await expect(
    f.analytics.personal(f.student.user.id, { batchId: newId() }),
  ).rejects.toMatchObject({ status: 403 });
});
it('Student users cannot read staff or global endpoints', async () => {
  await expect(
    f.analytics.overview(f.student.user.id, {}),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    f.analytics.batch(f.student.user.id, f.batch, {}),
  ).rejects.toMatchObject({ status: 403 });
});
it('does not leak credentials or private identity fields in analytics', async () => {
  const v = JSON.stringify(await batch());
  for (const forbidden of [
    'tokenHash',
    'ciphertext',
    'googleSubject',
    'proofDigest',
    'email',
    'phoneNumber',
  ])
    expect(v).not.toContain(forbidden);
});
it.each([
  { page: 0 },
  { pageSize: 51 },
  { collegeId: 'forged' },
  { from: '2026-01-01T00:00:00.000Z' },
  { from: '2025-01-01T00:00:00.000Z', to: '2026-11-01T00:00:00.000Z' },
  { from: '2026-11-01T00:00:00.000Z', to: '2026-01-01T00:00:00.000Z' },
  { role: 'SUPER_ADMIN' },
])('rejects invalid or unbounded filters %j', (q) =>
  expect(analyticsQuery.safeParse(q).success).toBe(false),
);
it('documents meaningful follow-up thresholds and overlapping attempted count', () => {
  const m = reportMetrics(
    Array.from({ length: 5 }, () => ({ status: 'ATTEMPTED_VERIFIED' })),
  );
  expect(m.noVerifiedSolve).toBe(5);
  expect(m.attempted).toBe(5);
  expect(
    reasons(
      {
        absent: 0,
        coding: m,
        missingAccount: false,
        failed: false,
        lastSuccess: null,
        pending: false,
        missingYear: false,
      },
      new Date(),
    ),
  ).toContain('LOW_COMPLETION');
  expect(attendanceMetrics([]).percentage).toBeNull();
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
async function cookie(user = f.owner) {
  const c = await new SessionService(
    f.repo.curriculum.learning.students.admin.auth,
    3600,
  ).create(user);
  return 'algora_session=' + c.token;
}
it.each([
  '/analytics/platform',
  '/analytics/overview',
  '/analytics/me',
  '/analytics/batches/' + 'a'.repeat(24),
])('requires session and no store on %s', async (path) => {
  const r = await request(app())
    .get('/api/v1' + path)
    .set('X-Role', 'SUPER_ADMIN');
  expect(r.status).toBe(401);
  expect(r.headers['cache-control']).toContain('no-store');
});
it('serves validated staff data and rejects malformed direct URLs', async () => {
  const c = await cookie();
  const r = await request(app())
    .get('/api/v1/analytics/batches/' + f.batch)
    .set('Cookie', c);
  expect(r.status).toBe(200);
  expect(r.body.data.summary.coding.assigned).toBe(1);
  expect(
    (
      await request(app())
        .get('/api/v1/analytics/batches/invalid')
        .set('Cookie', c)
    ).status,
  ).toBe(400);
});
it('rejects Student ID injection over authenticated HTTP', async () => {
  const r = await request(app())
    .get('/api/v1/analytics/me?studentProfileId=' + newId())
    .set('Cookie', await cookie(f.student.user));
  expect(r.status).toBe(400);
});
import ExcelJS from 'exceljs';
it('attendance analytics CSV reconciles with the finalized dashboard denominator across pages', async () => {
  await finalized('MORNING', true);
  await finalized('AFTERNOON');
  const v = await batch();
  const file = await f.analytics.exportAttendance(
    f.owner.id,
    f.batch,
    { page: 20, pageSize: 1 },
    'CSV',
    'test',
  );
  expect(file.rowCount).toBe(2);
  expect(file.summary).toEqual(v.summary.attendance);
  const csv = Buffer.from(file.base64, 'base64').toString();
  expect(csv).toContain('Attendance percentage');
  expect(csv).toContain('50');
  expect(csv).toContain('MORNING');
  expect(csv).toContain('AFTERNOON');
});
it('attendance analytics Excel uses the same shared writer and safe literal text', async () => {
  await finalized();
  f.attendanceRepo.rosterRows.values().next().value!.studentNameSnapshot =
    '=1+1';
  const file = await f.analytics.exportAttendance(
    f.owner.id,
    f.batch,
    {},
    'XLSX',
    'test',
  );
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(Buffer.from(file.base64, 'base64'));
  expect(book.worksheets[0]!.getCell('E2').type).toBe(ExcelJS.ValueType.String);
  expect(book.worksheets[0]!.getCell('E2').value).toBe('=1+1');
  expect(file.filename).toBe('algora-attendance-analytics.xlsx');
});
it('attendance CSV guards spreadsheet prefixes', async () => {
  await finalized();
  f.attendanceRepo.rosterRows.values().next().value!.studentNameSnapshot =
    ' =1+1';
  const file = await f.analytics.exportAttendance(
    f.owner.id,
    f.batch,
    {},
    'CSV',
    'test',
  );
  expect(Buffer.from(file.base64, 'base64').toString()).toContain("' =1+1");
});
it('Student users cannot export staff analytics', async () => {
  await expect(
    f.analytics.exportAttendance(f.student.user.id, f.batch, {}, 'CSV', 'test'),
  ).rejects.toMatchObject({ status: 403 });
});
it('requires CSRF and exact Origin for analytics export', async () => {
  const r = await request(app())
    .post('/api/v1/analytics/batches/' + f.batch + '/attendance/export')
    .set('Cookie', await cookie())
    .send({ format: 'CSV', confirmed: true, filters: {} });
  expect(r.status).toBe(403);
});
it('filters attendance by Year without changing coding evidence', async () => {
  await finalized();
  const v = await f.analytics.batch(f.owner.id, f.batch, { year: 4 });
  expect(v.summary.coding.assigned).toBe(0);
  expect(v.summary.attendance.eligible).toBe(0);
});
it('flags missing legacy Year and pending registration without fabricating coding rows', async () => {
  const student = await f.addStudent(false);
  f.repo.curriculum.learning.students.profiles.get(
    student.profile.id,
  )!.yearOfStudy = undefined;
  const v = await batch();
  expect(v.followUp.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        studentId: student.profile.id,
        reason: 'PENDING_REGISTRATION',
      }),
      expect.objectContaining({
        studentId: student.profile.id,
        reason: 'MISSING_YEAR',
      }),
    ]),
  );
  expect(v.summary.coding.assigned).toBe(1);
});
it('keeps verified attempts separate from solves and no verified accepted submission overlaps attempts', async () => {
  const a = await f.link();
  await f.verify(a.id);
  await f.queue();
  await f.service.processOne();
  for (const r of f.repo.rows.values()) {
    r.status = 'ATTEMPTED_VERIFIED';
    delete r.solvedAt;
  }
  const v = await batch();
  expect(v.summary.coding).toMatchObject({
    assigned: 1,
    attempted: 1,
    solved: 0,
    noVerifiedSolve: 1,
    unavailable: 0,
    coverage: 1,
    completion: 0,
  });
});
it('shows queued or failed coding synchronization freshness without raw provider messages', async () => {
  const a = await f.link();
  await f.verify(a.id);
  await f.queue();
  expect((await batch()).freshness.pending).toBe(1);
  f.repo.accounts.get(a.id)!.syncStatus = 'FAILED';
  const v = await batch();
  expect(v.freshness.failed).toBe(1);
  expect(v.followUp.items.some((r) => r.reason === 'SYNC_FAILED')).toBe(true);
});
it('uses documented stale synchronization threshold and does not infer a stale success', () => {
  const input = {
    absent: 0,
    coding: reportMetrics([{ status: 'NOT_STARTED' }]),
    missingAccount: false,
    failed: false,
    pending: false,
    missingYear: false,
  };
  expect(reasons({ ...input, lastSuccess: null }, new Date())).not.toContain(
    'SYNC_STALE',
  );
  expect(
    reasons(
      { ...input, lastSuccess: '2026-11-01T00:00:00.000Z' },
      new Date('2026-11-16T00:00:00.000Z'),
    ),
  ).toContain('SYNC_STALE');
});
it('empty analytics datasets produce N/A and no invented students', async () => {
  f.repo.curriculum.learning.students.profiles.clear();
  f.repo.curriculum.learning.enrollments.clear();
  const v = await batch();
  expect(v.students.total).toBe(0);
  expect(v.summary.coding.completion).toBeNull();
  expect(v.summary.coding.coverage).toBeNull();
  expect(v.summary.attendance.percentage).toBeNull();
});
it('rejects mismatched Course and Batch scopes', async () => {
  await expect(
    f.analytics.batch(f.owner.id, f.batch, { courseId: newId() }),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    f.analytics.batch(f.owner.id, f.batch, { batchId: newId() }),
  ).rejects.toMatchObject({ status: 403 });
});
it('retains assigned problem metadata when no Students are eligible', async () => {
  f.repo.curriculum.learning.enrollments.clear();
  const v = await batch();
  expect(v.summary.assignedProblems).toBe(1);
  expect(v.problems).toHaveLength(1);
  expect(v.problems[0]!.coding.completion).toBeNull();
});
it('flags stale queued jobs even before a first successful sync and preserves evidence counts', async () => {
  const a = await f.link();
  await f.verify(a.id);
  await f.queue();
  for (const j of f.repo.jobs.values())
    j.updatedAt = new Date(f.getNow().getTime() - 25 * 3600000).toISOString();
  const v = await batch();
  expect(v.followUp.items.some((r) => r.reason === 'SYNC_STALE')).toBe(true);
  expect(v.freshness.stale).toBe(1);
  expect(v.summary.coding.unavailable).toBe(1);
});

it('rechecks Student visibility permission before auditing and delivering attendance exports', async () => {
  await grant();
  const original = f.repo.transaction.bind(f.repo);
  vi.spyOn(f.repo, 'transaction').mockImplementationOnce(async (work) => {
    for (const g of f.repo.curriculum.learning.students.admin.assignments.values())
      g.permissions = g.permissions.filter((p) => p !== 'student.view');
    return original(work);
  });
  await expect(
    f.analytics.exportAttendance(f.admin.id, f.batch, {}, 'CSV', 'test'),
  ).rejects.toMatchObject({ status: 403 });
});
it('does not use a different College current Year to filter former attendance members', async () => {
  await finalized();
  const p = f.repo.curriculum.learning.students.profiles.get(
    f.student.profile.id,
  )!;
  p.collegeId = newId();
  p.yearOfStudy = 4;
  const v = await f.analytics.batch(f.owner.id, f.batch, { year: 4 });
  expect(v.summary.attendance.eligible).toBe(0);
  expect((await batch()).summary.attendance.eligible).toBe(1);
});

it('does not return a revoked College from a multi-College overview when another grant remains active', async () => {
  await grant();
  const admin = f.repo.curriculum.learning.students.admin,
    other = newId(),
    college = structuredClone(admin.colleges.get(f.college)!);
  college.id = other;
  college.code = 'SECOND';
  admin.colleges.set(other, college);
  await admin.read.putAssignment(
    f.admin.id,
    {
      collegeId: other,
      permissions: [
        'college.view',
        'attendance.manage',
        'progress.view',
        'student.view',
      ],
    },
    f.owner.id,
  );
  const original = f.source.catalog.bind(f.source);
  f.source.catalog = async (...args) => {
    const result = await original(...args);
    for (const g of admin.assignments.values())
      if (g.collegeId === other) g.status = 'REVOKED';
    return result;
  };
  await expect(f.analytics.overview(f.admin.id, {})).rejects.toMatchObject({
    status: 403,
  });
});

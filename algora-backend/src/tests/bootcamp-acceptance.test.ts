import { it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import ExcelJS from 'exceljs';
import { parse } from 'csv-parse/sync';
import { setupAnalytics } from './analytics-fixtures.js';
import { rawSubmission } from './coding-fixtures.js';
import { testUser } from './administration-fixtures.js';
import { registrationInput } from './student-fixtures.js';
import { AdministrationService } from '../administration/service.js';
import { permissions } from '../administration/contracts.js';
import { AttendanceService } from '../attendance/service.js';
import { AnalyticsService } from '../analytics/service.js';
import { listSchema } from '../learning/contracts.js';
import type { SessionRecord } from '../attendance/contracts.js';
import type { ReportType } from '../coding/reports.js';
it('accepts an isolated 120-Student Java and DSA bootcamp across registration, publication, QR, evidence, analytics and exports', async () => {
  const f = await setupAnalytics(),
    timings: Record<string, number> = {};
  async function measured<T>(name: string, work: () => Promise<T>) {
    const start = performance.now();
    const result = await work();
    timings[name] = Math.round((performance.now() - start) * 100) / 100;
    return result;
  }
  const admin = f.repo.curriculum.learning.students.admin,
    administration = new AdministrationService(admin),
    applicant = testUser();
  admin.auth.users.set(applicant.id, applicant);
  const request = await administration.submit(
    applicant.id,
    {
      fullName: 'Bootcamp faculty',
      collegeIds: [f.college],
      reason: 'Institutional faculty requesting authorized bootcamp operations',
    },
    'acceptance',
  );
  await administration.approve(
    f.owner.id,
    request.id,
    {
      assignments: [{ collegeId: f.college, permissions: [...permissions] }],
      reviewNote: 'Reviewed institutional faculty identity',
      internalNote: 'Synthetic acceptance only',
    },
    'acceptance',
  );
  const actor = applicant.id;
  const learners = [f.student];
  await measured('registration_verification_enrollment_119', async () => {
    for (let i = 1; i < 120; i++) {
      const learner = await f.addStudent(false, false);
      const profile = await f.students.verify(
        actor,
        learner.profile.id,
        {
          expectedRevision: learner.profile.revision,
          method: 'AUTHORIZED_MANUAL',
          evidenceReference:
            'Synthetic registrar verification for isolated acceptance',
          confirmed: true,
        },
        false,
        'acceptance',
      );
      await f.learning.manual(
        actor,
        f.batch,
        {
          rollNumber: profile.rollNumber,
          requestKey: randomUUID(),
          confirmed: true,
        },
        'acceptance',
      );
      const credential =
        (await f.repo.read.curriculum.learning.students.credential(
          profile.id,
        ))!;
      learners.push({ ...learner, profile, token: f.vault.reveal(credential) });
    }
  });
  expect(
    learners.every(
      (l) => l.profile.collegeId === f.college && l.profile.yearOfStudy === 2,
    ),
  ).toBe(true);
  expect(new Set(learners.map((l) => l.profile.rollNumber)).size).toBe(120);
  const duplicate = testUser();
  admin.auth.users.set(duplicate.id, duplicate);
  await expect(
    f.students.register(
      duplicate.id,
      {
        ...registrationInput(f.college),
        rollNumber: f.student.profile.rollNumber,
      },
      'acceptance',
    ),
  ).rejects.toMatchObject({ status: 409 });
  const draft = await f.curriculum.newDraft(
    f.owner.id,
    f.course,
    {},
    'acceptance',
  );
  let revision = 0,
    firstProblem = '',
    editorial = '';
  for (let day = 1; day <= 5; day++) {
    const assignments = [];
    for (let i = 0; i < 15; i++) {
      const platform = i < 10 ? 'CODEFORCES' : i < 13 ? 'LEETCODE' : 'CODECHEF';
      const url =
        platform === 'CODEFORCES'
          ? `https://codeforces.com/problemset/problem/${day * 1000 + i + 1}/A`
          : platform === 'LEETCODE'
            ? `https://leetcode.com/problems/acceptance-day-${day}-problem-${i}/`
            : `https://www.codechef.com/problems/ACCEPT${day}${i}`;
      const problem = await f.curriculum.saveProblem(
        f.owner.id,
        {
          platform,
          title: `Java DSA Day ${day} problem ${i + 1}`,
          url,
          difficulty: 'EASY',
          topics: ['Java', 'DSA'],
          ownerCollegeId: null,
        },
        undefined,
        'acceptance',
      );
      if (!firstProblem) {
        firstProblem = problem.id;
        const approach = randomUUID();
        const e = await f.curriculum.saveEditorial(
          f.owner.id,
          problem.id,
          undefined,
          {
            ownerCollegeId: null,
            body: {
              title: 'Java array traversal',
              approaches: [
                {
                  id: approach,
                  title: 'Linear traversal',
                  steps: ['Visit each element'],
                },
              ],
              codeSolutions: [
                {
                  id: randomUUID(),
                  approachId: approach,
                  language: 'JAVA',
                  code: 'class Main { public static void main(String[] args) { } }',
                },
              ],
            },
          },
          'acceptance',
        );
        await f.curriculum.publishEditorial(
          f.owner.id,
          problem.id,
          e.id,
          { expectedRevision: 0, confirmed: true },
          'acceptance',
        );
        editorial = e.id;
      }
      assignments.push({
        problemId: problem.id,
        category: 'REQUIRED',
        editorialId: problem.id === firstProblem ? editorial : null,
        editorialVisibility: problem.id === firstProblem ? 'VISIBLE' : 'HIDDEN',
      });
    }
    const saved = await f.curriculum.saveDay(
      f.owner.id,
      f.course,
      draft.id,
      undefined,
      {
        dayNumber: day,
        title: 'Java DSA Learning Day ' + day,
        publicationStatus: 'PUBLISHED',
        problemAssignments: assignments,
        expectedRevision: revision,
      },
      'acceptance',
    );
    revision = saved.revision;
  }
  await f.curriculum.publish(
    f.owner.id,
    f.course,
    draft.id,
    { expectedRevision: revision, confirmed: true },
    'acceptance',
  );
  const batch = (await f.repo.read.curriculum.learning.batch(f.batch))!,
    impact = await f.curriculum.assignmentPreview(actor, f.batch, draft.id);
  await f.curriculum.assign(
    actor,
    f.batch,
    {
      curriculumRevisionId: draft.id,
      expectedBatchRevision: impact.batchRevision,
      expectedPreviousRevisionId: batch.curriculumRevisionId,
      impactFingerprint: impact.impactFingerprint,
      reason: 'Reviewed the five Day bootcamp curriculum',
      confirmed: true,
    },
    'acceptance',
  );
  const visible = await f.curriculum.studentDay(f.student.user.id, f.batch, 1);
  expect(visible.day.problemAssignments).toHaveLength(15);
  expect(
    (
      await f.curriculum.studentEditorial(
        f.student.user.id,
        f.batch,
        1,
        firstProblem,
      )
    ).body.codeSolutions[0]!.language,
  ).toBe('JAVA');
  await measured('enrollment_lookup', () =>
    f.repo.read.curriculum.learning.current(
      f.batch,
      f.student.profile.rollNumber,
      f.student.profile.id,
    ),
  );
  const roster = await measured('batch_roster_page', () =>
    f.learning.enrollments(
      actor,
      f.batch,
      listSchema.parse({ page: 1, pageSize: 50 }),
    ),
  );
  expect(roster.total).toBe(120);
  expect(roster.items).toHaveLength(50);
  const attendance = new AttendanceService(f.attendanceRepo, f.learning),
    days = await f.repo.read.curriculum.allFrozenDays(draft.id);
  let firstSession: SessionRecord | undefined;
  let scanTotal = 0,
    finalizeTotal = 0;
  for (const day of days)
    for (const type of ['MORNING', 'AFTERNOON'] as const) {
      let s = await attendance.create(
        actor,
        f.batch,
        { learningDayId: day.id, sessionType: type },
        'acceptance',
      );
      s = (await attendance.transition(
        actor,
        f.batch,
        s.id,
        'open',
        {
          expectedRevision: s.revision,
          confirmed: true,
          reason: 'Open synthetic bootcamp session for acceptance',
        },
        'acceptance',
      ))!;
      for (let i = 0; i < 90; i++) {
        const start = performance.now();
        const result = await attendance.scan(
          actor,
          f.batch,
          s.id,
          { credential: learners[i]!.token },
          'acceptance',
        );
        scanTotal += performance.now() - start;
        expect(result.outcome).toBe('MARKED');
      }
      expect(
        (
          await attendance.scan(
            actor,
            f.batch,
            s.id,
            { credential: learners[0]!.token },
            'acceptance',
          )
        ).outcome,
      ).toBe('ALREADY_MARKED');
      const detail = await attendance.detail(actor, f.batch, s.id);
      const closed = (await attendance.transition(
        actor,
        f.batch,
        s.id,
        'close',
        {
          expectedRevision: detail.session.revision,
          confirmed: true,
          reason: 'Close the completed synthetic session',
        },
        'acceptance',
      ))!;
      const start = performance.now();
      const finalized = (await attendance.transition(
        actor,
        f.batch,
        s.id,
        'finalize',
        {
          expectedRevision: closed.revision,
          confirmed: true,
          reason: 'Finalize synthetic attendance after review',
        },
        'acceptance',
      ))!;
      finalizeTotal += performance.now() - start;
      firstSession ??= finalized;
    }
  timings.qr_mark_mean_ms = scanTotal / 900;
  timings.finalization_mean_ms = finalizeTotal / 10;
  const correctionTarget = [...f.attendanceRepo.rows.values()].find(
    (r) =>
      r.attendanceSessionId === firstSession!.id &&
      r.studentProfileId === learners[90]!.profile.id,
  )!;
  await attendance.correct(
    actor,
    f.batch,
    firstSession!.id,
    correctionTarget.id,
    {
      status: 'EXCUSED',
      expectedRevision: firstSession!.revision,
      expectedRecordRevision: correctionTarget.revision,
      confirmed: true,
      reason: 'Documented exception in synthetic acceptance',
    },
    'acceptance',
  );
  const before = await f.analytics.batch(actor, f.batch, {});
  expect(before.summary.coding).toMatchObject({
    assigned: 9000,
    unavailable: 9000,
    solved: 0,
    coverage: 0,
  });
  const account = await f.link();
  await f.verify(account.id);
  f.setResponse({
    status: 'OK',
    result: [
      rawSubmission(new Date(f.getNow().getTime() - 1000), {
        problem: { contestId: 1001, index: 'A' },
      }),
    ],
  });
  await f.queue();
  await f.service.processOne();
  const overview = await measured('batch_analytics', () =>
    f.analytics.batch(actor, f.batch, { page: 3, pageSize: 50 }),
  );
  expect(overview.summary.coding).toMatchObject({
    assigned: 9000,
    solved: 1,
    unavailable: 8950,
    coverage: 50 / 9000,
  });
  expect(overview.students.total).toBe(120);
  expect(overview.students.items).toHaveLength(20);
  expect(overview.summary.attendance).toMatchObject({
    eligible: 1200,
    present: 900,
    absent: 299,
    excused: 1,
    attendanceRate: 0.75,
    participationRate: 900 / 1199,
  });
  const legacy = await attendance.reports(actor, f.batch, {
    page: 1,
    pageSize: 50,
    search: '',
  });
  expect(legacy.rates.attendanceRate).toBe(
    overview.summary.attendance.attendanceRate,
  );
  expect(legacy.rates.participationRate).toBe(
    overview.summary.attendance.participationRate,
  );
  await measured('day_analytics', () =>
    f.analytics.batch(actor, f.batch, { day: 1 }),
  );
  await measured('student_performance_page', () =>
    f.analytics.batch(actor, f.batch, { page: 2, pageSize: 20, sort: 'roll' }),
  );
  const operational = new AnalyticsService(
    f.service,
    f.learning,
    f.repo,
    f.source,
    f.getNow,
    { qr: () => true, coding: () => true, worker: () => true },
  );
  const ready = await operational.readiness(actor, f.batch, {});
  expect(ready.attendanceReady).toBe(true);
  expect(ready.days).toHaveLength(5);
  expect(ready.sessions).toHaveLength(10);
  expect(ready.days.every((d) => d.finalizedSessions === 2)).toBe(true);
  for (const type of [
    'DAY',
    'PROBLEM',
    'STUDENT',
    'BATCH',
    'COMPLETE',
  ] as ReportType[])
    for (const format of ['CSV', 'XLSX'] as const) {
      const filters =
        type === 'DAY'
          ? { day: 1, page: 9, pageSize: 1 }
          : { page: 9, pageSize: 1 };
      const file = await measured(`export_${type}_${format}`, () =>
        f.service.exported(actor, f.batch, filters, format, 'acceptance', type),
      );
      expect(file.rowCount).toBe(type === 'DAY' ? 1800 : 9000);
      expect(file.studentCount).toBe(120);
      expect(file.assignmentOpportunityCount).toBe(
        type === 'DAY' ? 1800 : 9000,
      );
      if (format === 'XLSX') {
        const book = new ExcelJS.Workbook();
        await book.xlsx.load(Buffer.from(file.base64, 'base64'));
        if (type === 'COMPLETE') {
          expect(book.worksheets).toHaveLength(5);
          expect(book.getWorksheet('Detailed Progress')!.rowCount).toBe(9001);
          expect(book.getWorksheet('Student Progress')!.rowCount).toBe(121);
        }
      } else {
        const csv = Buffer.from(file.base64, 'base64').toString();
        const records = parse(csv, { bom: true, columns: true }) as Record<
          string,
          string
        >[];
        expect(records).toHaveLength(
          type === 'DAY'
            ? 120
            : type === 'PROBLEM'
              ? 75
              : type === 'BATCH'
                ? 84
                : 9000,
        );
        expect(file.csvRecordCount).toBe(records.length);
        expect(csv).toMatch(/verification/i);
        if (type === 'STUDENT' || type === 'COMPLETE')
          expect(csv).toContain('VERIFICATION_UNAVAILABLE');
        expect(csv).not.toMatch(/tokenHash|ciphertext|googleSubject/);
      }
    }
  for (const format of ['CSV', 'XLSX'] as const) {
    const file = await f.analytics.exportAttendance(
      actor,
      f.batch,
      { page: 100, pageSize: 1 },
      format,
      'acceptance',
    );
    expect(file.rowCount).toBe(1200);
    expect(file.summary.attendanceRate).toBe(0.75);
    expect(file.summary.participationRate).toBe(900 / 1199);
  }
  for (const l of learners)
    expect(JSON.stringify(overview)).not.toContain(l.token);
  const dir = new URL('../../../.artifacts/', import.meta.url);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    new URL('phase10-bootcamp-timings.json', dir),
    JSON.stringify(
      {
        kind: 'isolated in-memory service acceptance, not Atlas or browser latency',
        students: 120,
        days: 5,
        assignedProblems: 75,
        codingOpportunities: 9000,
        attendanceOpportunities: 1200,
        milliseconds: timings,
      },
      null,
      2,
    ),
  );
}, 180000);

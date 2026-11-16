import { attendanceFile } from '../attendance/file.js';
import { AppError } from '../middleware/errors.js';
import type { ProgressRepository } from '../coding/contracts.js';
import { CodingService } from '../coding/service.js';
import { LearningService } from '../learning/service.js';
import { listSchema } from '../learning/contracts.js';
import type { BatchRecord } from '../learning/contracts.js';
import { released } from '../curriculum/service.js';
import {
  analyticsQuery,
  followUpPolicy,
  paging,
  type AnalyticsQuery,
} from './contracts.js';
import {
  attendanceRows,
  attendanceMetrics,
  codingMetrics,
  reasons,
} from './calculations.js';
import type { AnalyticsSource } from './repository.js';
const denied = () => {
  throw new AppError(
    403,
    'ANALYTICS_FORBIDDEN',
    'Current analytics permissions are required',
  );
};
const required = [
  'college.view',
  'progress.view',
  'attendance.manage',
  'student.view',
];
const latest = (values: (string | null | undefined)[]) =>
  values
    .filter((v): v is string => !!v)
    .sort()
    .at(-1) ?? null;
export class AnalyticsService {
  constructor(
    private coding: CodingService,
    private learning: LearningService,
    private repo: ProgressRepository,
    private source: AnalyticsSource,
    private now = () => new Date(),
  ) {}
  async scope(user: string, q: AnalyticsQuery, superOnly = false) {
    await this.repo.ensureReady();
    const a = this.repo.read.curriculum.learning.students.admin,
      u = await a.user(user);
    if (
      !u ||
      !u.emailVerified ||
      u.accountStatus !== 'ACTIVE' ||
      !['SUPER_ADMIN', 'ADMIN'].includes(u.role) ||
      (superOnly && u.role !== 'SUPER_ADMIN')
    )
      denied();
    if (u!.role === 'SUPER_ADMIN') return null;
    const scopes: string[] = [];
    for (const grant of await a.assignments(user))
      if (
        grant.status === 'ACTIVE' &&
        required.every((p) => grant.permissions.includes(p as never)) &&
        (await a.college(grant.collegeId))?.status === 'ACTIVE'
      )
        scopes.push(grant.collegeId);
    if (!scopes.length || (q.collegeId && !scopes.includes(q.collegeId)))
      denied();
    return scopes;
  }
  private async authorize(user: string, batch: string, q: AnalyticsQuery) {
    const scope = await this.scope(user, q),
      l = this.repo.read.curriculum.learning;
    const { b } = await this.learning.progressAuthority(l, user, batch);
    await this.learning.attendanceAuthority(l, user, batch);
    if (
      (scope && !scope.includes(b.collegeId)) ||
      (q.collegeId && q.collegeId !== b.collegeId) ||
      (q.courseId && q.courseId !== b.courseId) ||
      (q.batchId && q.batchId !== b.id)
    )
      denied();
    return b;
  }
  private progressFilters(q: AnalyticsQuery) {
    return {
      day: q.day,
      platform: q.platform,
      verification: q.verification,
      from: q.from,
      to: q.to,
      year: q.year,
      search: q.search,
    };
  }
  private async data(user: string, b: BatchRecord, q: AnalyticsQuery) {
    const unit = await this.source.prepare(this.repo.read, b.id),
      l = unit.curriculum.learning;
    const data = await this.coding.reportData(
      user,
      b.id,
      this.progressFilters(q),
      unit,
      true,
    );
    const attendance = await this.source.attendance(b.id, q),
      allMarks = attendanceRows(attendance);
    const roster = [];
    for (let page = 1; page <= 40; page++) {
      const r = await l.enrollments(
        b.id,
        listSchema.parse({ page, pageSize: 50 }),
        false,
      );
      if (r.total > 2000)
        throw new AppError(
          413,
          'ANALYTICS_TOO_LARGE',
          'Refine the Batch population',
        );
      roster.push(...r.items);
      if (page >= r.totalPages) break;
    }
    const candidates = [];
    for (const e of roster) {
      if (!e.studentProfileId) continue;
      const p = await l.students.profile(e.studentProfileId);
      if (
        !p ||
        p.collegeId !== b.collegeId ||
        (q.year && p.yearOfStudy !== q.year) ||
        (q.search &&
          !(p.fullName + ' ' + p.rollNumber)
            .toLowerCase()
            .includes(q.search.toLowerCase()))
      )
        continue;
      candidates.push({ p, e });
    }
    const candidateIds = new Set<string>();
    if (q.year)
      for (const id of new Set(allMarks.map((m) => m.studentId))) {
        const p = await l.students.profile(id);
        if (p?.collegeId === b.collegeId && p.yearOfStudy === q.year)
          candidateIds.add(id);
      }

    // Historical snapshots remain authoritative even when the current enrollment is withdrawn.
    const marks = allMarks.filter(
      (m) =>
        (!q.year || candidateIds.has(m.studentId)) &&
        (!q.search ||
          (m.name + ' ' + m.roll)
            .toLowerCase()
            .includes(q.search.toLowerCase())),
    );
    const students = data.students.map((s) => {
      const rows = data.rows.filter((r) => r.studentId === s.id),
        am = attendanceMetrics(marks.filter((m) => m.studentId === s.id));
      return {
        ...s,
        coding: codingMetrics(rows),
        attendance: am,
        lastSync: latest(rows.map((r) => r.lastSync)),
      };
    });
    const followUp = [];
    const freshness = { pending: 0, failed: 0 };
    for (const { p, e } of candidates) {
      const rows = data.rows.filter((r) => r.studentId === p.id),
        coding = codingMetrics(rows),
        am = attendanceMetrics(marks.filter((m) => m.studentId === p.id)),
        accounts = await unit.accounts(p.id),
        activePlatforms = new Set(rows.map((r) => r.platform)),
        ac = accounts.filter((a) => activePlatforms.has(a.platform)),
        lastSuccess = latest(ac.map((a) => a.lastSuccessAt));
      const jobs = (await Promise.all(ac.map((a) => unit.jobs(a.id, b.id))))
        .flat()
        .filter(
          (j) =>
            j.enrollmentId === e.id &&
            j.curriculumRevisionId === b.curriculumRevisionId &&
            ac.some(
              (a) => a.id === j.accountId && a.revision === j.accountRevision,
            ),
        )
        .sort(
          (a, b) =>
            b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
        );
      const latestJobs = ac.flatMap((a) => {
        const job = jobs.find((j) => j.accountId === a.id);
        return job ? [job] : [];
      });
      const stale = latestJobs.some(
        (j) =>
          j.active &&
          (this.now().getTime() - Date.parse(j.updatedAt) >
            followUpPolicy.staleHours * 3600000 ||
            (j.status === 'RUNNING' &&
              !!j.leaseUntil &&
              Date.parse(j.leaseUntil) < this.now().getTime())),
      );
      const failed =
        ac.some((a) => ['FAILED', 'RATE_LIMITED'].includes(a.syncStatus)) ||
        latestJobs.some((j) => j.status === 'FAILED');
      freshness.pending += ac.filter(
        (a) =>
          ['QUEUED', 'RUNNING'].includes(a.syncStatus) ||
          latestJobs.some(
            (j) =>
              j.accountId === a.id &&
              ['QUEUED', 'RUNNING', 'RETRY_WAIT'].includes(j.status),
          ),
      ).length;
      freshness.failed += ac.filter(
        (a) =>
          ['FAILED', 'RATE_LIMITED'].includes(a.syncStatus) ||
          latestJobs.some((j) => j.accountId === a.id && j.status === 'FAILED'),
      ).length;
      const missing =
        rows.some((r) => r.verification !== 'VERIFIED') ||
        ac.some(
          (a) =>
            !a.active ||
            !a.proofExpiresAt ||
            Date.parse(a.proofExpiresAt) <= this.now().getTime(),
        );
      const why = reasons(
        {
          absent: am.absent,
          coding,
          missingAccount: missing,
          failed,
          stale,
          lastSuccess,
          pending:
            p.verificationStatus !== 'VERIFIED' ||
            e.status === 'PENDING_VERIFICATION',
          missingYear: !p.yearOfStudy,
        },
        this.now(),
      );
      for (const reason of why)
        followUp.push({
          id: p.id + ':' + reason,
          studentId: p.id,
          name: p.fullName,
          roll: p.rollNumber,
          batchId: b.id,
          batch: b.name,
          reason,
          absent: am.absent,
          assigned: coding.assigned,
          completion: coding.completion,
          coverage: coding.coverage,
          lastSuccess,
          updatedAt: latest([
            p.updatedAt,
            ...ac.map((a) => a.lastCheckedAt),
            ...latestJobs.map((j) => j.updatedAt),
            ...marks
              .filter((m) => m.studentId === p.id)
              .map((m) => m.updatedAt),
          ]),
        });
    }
    const frozen = b.curriculumRevisionId
        ? await unit.curriculum.allFrozenDays(b.curriculumRevisionId)
        : [],
      controls = b.curriculumRevisionId
        ? await unit.curriculum.releases(b.id, b.curriculumRevisionId)
        : [];
    const days = frozen
      .filter(
        (d) =>
          released(d, this.now()) &&
          !controls.some((c) => c.dayId === d.id && c.restricted) &&
          (!q.day || d.dayNumber === q.day),
      )
      .map((d) => {
        const rows = data.rows.filter((r) => r.day === d.dayNumber),
          m = marks.filter((r) => r.day === d.dayNumber);
        return {
          id: d.id,
          day: d.dayNumber,
          title: d.title,
          publishedAssignments: d.problemAssignments.filter(
            (a) => !q.platform || a.problem.platform === q.platform,
          ).length,
          eligibleStudents: data.students.length,
          coding: codingMetrics(rows),
          morning: attendanceMetrics(m.filter((r) => r.type === 'MORNING')),
          afternoon: attendanceMetrics(m.filter((r) => r.type === 'AFTERNOON')),
        };
      });
    const sessions = attendance.sessions.map((s) => {
      const m = marks.filter((r) => r.sessionId === s.id);
      return {
        id: s.id,
        day: s.dayNumber,
        title: s.dayTitle,
        type: s.sessionType,
        status: s.status,
        eligible: m.length,
        present: m.filter((r) => r.status === 'PRESENT').length,
        absent:
          s.status === 'FINALIZED'
            ? m.filter((r) => r.status === 'ABSENT').length
            : null,
        percentage: attendanceMetrics(m).percentage,
      };
    });
    return { unit, data, marks, students, followUp, days, sessions, freshness };
  }
  async batch(user: string, batch: string, input: unknown) {
    const q = analyticsQuery.parse(input),
      b = await this.authorize(user, batch, q),
      v = await this.data(user, b, q);
    const problems = v.data.assignments.map((a) => ({
      id: a.id,
      day: a.dayNumber,
      title: a.title,
      platform: a.platform,
      problemKey: a.problemKey,
      coding: codingMetrics(v.data.rows.filter((r) => r.assignmentId === a.id)),
    }));
    const platforms = [
      ...new Set(v.data.assignments.map((a) => a.platform)),
    ].map((platform) => ({
      platform,
      coding: codingMetrics(v.data.rows.filter((r) => r.platform === platform)),
    }));
    const sort = (
      a: (typeof v.students)[number],
      b: (typeof v.students)[number],
    ) => {
      const get = (s: typeof a) =>
        q.sort === 'completion'
          ? (s.coding.completion ?? -1)
          : q.sort === 'attendance'
            ? (s.attendance.percentage ?? -1)
            : q.sort === 'lastSuccess'
              ? (s.lastSuccess ?? '')
              : q.sort === 'name'
                ? s.name
                : s.roll;
      const x = get(a),
        y = get(b);
      return (
        (typeof x === 'number' && typeof y === 'number'
          ? x - y
          : String(x).localeCompare(String(y))) *
          (q.direction === 'asc' ? 1 : -1) || a.id.localeCompare(b.id)
      );
    };
    const output = {
      generatedAt: this.now().toISOString(),
      batch: {
        id: b.id,
        name: b.name,
        college: v.data.college.name,
        collegeId: b.collegeId,
        course: b.snapshot.title,
        courseId: b.courseId,
        status: b.status,
        curriculumRevisionId: b.curriculumRevisionId ?? null,
      },
      summary: {
        eligibleStudents: v.data.students.length,
        releasedDays: v.days.length,
        assignedProblems: v.data.assignments.length,
        coding: codingMetrics(v.data.rows),
        attendance: attendanceMetrics(v.marks),
        finalizedSessions: v.sessions.filter((s) => s.status === 'FINALIZED')
          .length,
        pendingSessions: v.sessions.filter((s) =>
          ['OPEN', 'CLOSED'].includes(s.status),
        ).length,
      },
      freshness: {
        lastSuccess: latest(v.students.map((s) => s.lastSuccess)),
        pending: v.freshness.pending,
        failed: v.freshness.failed,
        stale: v.followUp.filter((r) => r.reason === 'SYNC_STALE').length,
        unavailable: v.data.rows.filter(
          (r) => r.status === 'VERIFICATION_UNAVAILABLE',
        ).length,
      },
      days: v.days,
      sessions: v.sessions,
      platforms,
      problems,
      students: paging(v.students.sort(sort), q),
      attendanceMatrix: paging(
        [...new Set(v.marks.map((r) => r.studentId))]
          .map((id) => ({
            id,
            name: v.marks.find((m) => m.studentId === id)!.name,
            roll: v.marks.find((m) => m.studentId === id)!.roll,
            marks: v.marks.filter((m) => m.studentId === id),
          }))
          .sort(
            (a, b) => a.roll.localeCompare(b.roll) || a.id.localeCompare(b.id),
          ),
        q,
      ),
      followUp: paging(
        v.followUp
          .filter((r) => !q.reason || r.reason === q.reason)
          .sort(
            (a, b) =>
              (q.sort === 'reason'
                ? a.reason.localeCompare(b.reason)
                : a.roll.localeCompare(b.roll)) *
                (q.direction === 'asc' ? 1 : -1) || a.id.localeCompare(b.id),
          ),
        q,
      ),
      policy: followUpPolicy,
    };
    await this.authorize(user, batch, q);
    return output;
  }
  async overview(user: string, input: unknown, superOnly = false) {
    const q = analyticsQuery.parse(input),
      scope = await this.scope(user, q, superOnly),
      catalog = await this.source.catalog(scope, q);
    const results: {
      b: BatchRecord;
      v: Awaited<ReturnType<AnalyticsService['data']>>;
    }[] = [];
    if (q.batchId && !catalog.batches.some((b) => b.id === q.batchId)) denied();
    let opportunities = 0;
    for (const b of catalog.batches) {
      await this.authorize(user, b.id, q);
      const v = await this.data(user, b, q);
      opportunities += v.data.rows.length;
      if (opportunities > 50000)
        throw new AppError(
          413,
          'ANALYTICS_TOO_LARGE',
          'Choose a College or Batch to reduce analytics size',
        );
      results.push({ b, v });
    }
    const rows = results.flatMap((r) => r.v.data.rows),
      marks = results.flatMap((r) => r.v.marks);
    const profileFilter = (p: (typeof catalog.profiles)[number]) =>
      (!q.year || p.yearOfStudy === q.year) &&
      (!q.search ||
        (p.fullName + ' ' + p.rollNumber)
          .toLowerCase()
          .includes(q.search.toLowerCase()));
    const profiles = catalog.profiles.filter(profileFilter),
      alerts = [];
    for (const { b, v } of results) {
      if (!b.curriculumRevisionId)
        alerts.push({
          id: b.id + ':curriculum',
          batchId: b.id,
          message: 'Batch has no assigned curriculum',
          target: 'curriculum',
        });
      for (const d of v.days)
        if (!d.publishedAssignments)
          alerts.push({
            id: b.id + ':day:' + d.id,
            batchId: b.id,
            message: 'Learning Day ' + d.day + ' has no published problems',
            target: 'curriculum',
          });
      if (v.sessions.some((s) => ['OPEN', 'CLOSED'].includes(s.status)))
        alerts.push({
          id: b.id + ':attendance',
          batchId: b.id,
          message: 'Attendance awaits finalization',
          target: 'attendance',
        });
      if (
        v.followUp.some(
          (f) => f.reason === 'SYNC_FAILED' || f.reason === 'SYNC_STALE',
        )
      )
        alerts.push({
          id: b.id + ':sync',
          batchId: b.id,
          message: 'Coding synchronization needs attention',
          target: 'progress',
        });
    }
    const colleges = catalog.colleges.map((c) => {
      const rs = results.filter((r) => r.b.collegeId === c.id),
        ps = profiles.filter((p) => p.collegeId === c.id),
        ms = rs.flatMap((r) => r.v.marks),
        cs = rs.flatMap((r) => r.v.data.rows);
      if (
        scope === null &&
        !catalog.authorizedAdmins.includes(c.id) &&
        c.status === 'ACTIVE'
      )
        alerts.push({
          id: c.id + ':admin',
          batchId: null,
          message: c.name + ' has no active authorized Admin',
          target: 'admins',
        });
      if (ps.some((p) => p.verificationStatus !== 'VERIFIED'))
        alerts.push({
          id: c.id + ':students',
          batchId: null,
          message: c.name + ' has Students awaiting verification',
          target: 'students',
        });
      return {
        id: c.id,
        name: c.name,
        code: c.code,
        registeredStudents: ps.length,
        verifiedStudents: ps.filter((p) => p.verificationStatus === 'VERIFIED')
          .length,
        activeBatches: rs.filter((r) => r.b.status === 'ACTIVE').length,
        enrolledStudents: new Set(
          rs.flatMap((r) => r.v.students.map((s) => s.id)),
        ).size,
        attendance: attendanceMetrics(ms),
        coding: codingMetrics(cs),
        lastActivity: latest([
          c.updatedAt,
          ...ps.map((p) => p.updatedAt),
          ...rs.map((r) => r.b.updatedAt),
          ...ms.map((m) => m.updatedAt),
          ...cs.map((r) => r.lastSync),
        ]),
      };
    });
    const operationalFollowUp = results.flatMap((r) => r.v.followUp);
    if (!q.courseId && !q.batchId)
      for (const p of profiles) {
        for (const reason of [
          p.verificationStatus !== 'VERIFIED' ? 'PENDING_REGISTRATION' : null,
          !p.yearOfStudy ? 'MISSING_YEAR' : null,
        ]) {
          if (
            !reason ||
            operationalFollowUp.some(
              (r) => r.studentId === p.id && r.reason === reason,
            )
          )
            continue;
          operationalFollowUp.push({
            id: p.id + ':' + reason,
            studentId: p.id,
            name: p.fullName,
            roll: p.rollNumber,
            batchId: '',
            batch: 'Not enrolled in selected Batches',
            reason,
            absent: 0,
            assigned: 0,
            completion: null,
            coverage: null,
            lastSuccess: null,
            updatedAt: p.updatedAt,
          });
        }
      }
    const followUp = operationalFollowUp
      .filter((r) => !q.reason || r.reason === q.reason)
      .sort(
        (a, b) =>
          (q.sort === 'reason'
            ? a.reason.localeCompare(b.reason)
            : q.sort === 'name'
              ? a.name.localeCompare(b.name)
              : a.roll.localeCompare(b.roll)) *
            (q.direction === 'asc' ? 1 : -1) || a.id.localeCompare(b.id),
      );
    const output = {
      generatedAt: this.now().toISOString(),
      summary: {
        colleges: catalog.colleges.length,
        activeColleges: catalog.colleges.filter((c) => c.status === 'ACTIVE')
          .length,
        registeredStudents: profiles.length,
        verifiedStudents: profiles.filter(
          (p) => p.verificationStatus === 'VERIFIED',
        ).length,
        courses: catalog.courses,
        activeBatches: results.filter((r) => r.b.status === 'ACTIVE').length,
        enrollments: catalog.enrollments,
        enrolledStudents: new Set(
          results.flatMap((r) => r.v.students.map((s) => s.id)),
        ).size,
        learningDays: results.reduce((n, r) => n + r.v.days.length, 0),
        assignedProblems: results.reduce(
          (n, r) => n + r.v.data.assignments.length,
          0,
        ),
        attendanceSessions: results.reduce(
          (n, r) =>
            n + r.v.sessions.filter((s) => s.status === 'FINALIZED').length,
          0,
        ),
        coding: codingMetrics(rows),
        attendance: attendanceMetrics(marks),
        followUpStudents: new Set(followUp.map((f) => f.studentId)).size,
      },
      colleges: paging(colleges, q),
      batches: results.map(({ b, v }) => ({
        id: b.id,
        name: b.name,
        collegeId: b.collegeId,
        courseId: b.courseId,
        course: b.snapshot.title,
        status: b.status,
        coding: codingMetrics(v.data.rows),
        attendance: attendanceMetrics(v.marks),
        lastSuccess: latest(v.students.map((s) => s.lastSuccess)),
      })),
      alerts: paging(alerts, q),
      followUp: paging(followUp, q),
      policy: followUpPolicy,
    };
    const currentScope = await this.scope(user, q, superOnly);
    if (
      currentScope &&
      catalog.colleges.some((c) => !currentScope.includes(c.id))
    )
      denied();
    return output;
  }
  async exportAttendance(
    user: string,
    batch: string,
    input: unknown,
    format: 'CSV' | 'XLSX',
    requestId: string,
  ) {
    const q = analyticsQuery.parse(input),
      b = await this.authorize(user, batch, q),
      v = await this.data(user, b, q);
    if (v.marks.length > 10000)
      throw new AppError(
        413,
        'EXPORT_TOO_LARGE',
        'Refine attendance filters to at most 10000 rows',
      );
    const summary = attendanceMetrics(v.marks);
    const headers = [
      'College',
      'Course',
      'Batch',
      'Roll number',
      'Student',
      'Day',
      'Session type',
      'Session state',
      'Attendance status',
      'Official',
      'Corrected',
      'Eligible finalized opportunities',
      'Finalized present',
      'Finalized absent',
      'Attendance percentage',
    ];
    const rows = v.marks.map((m) => [
      v.data.college.name,
      b.snapshot.title,
      b.name,
      m.roll,
      m.name,
      m.day,
      m.type,
      m.sessionStatus,
      m.status,
      String(m.official),
      String(m.corrected),
      summary.eligible,
      summary.present,
      summary.absent,
      summary.percentage === null ? 'N/A' : summary.percentage * 100,
    ]);
    const file = await attendanceFile(headers, rows, format, true);
    if (file.base64.length > 14 * 1024 * 1024)
      throw new AppError(413, 'EXPORT_TOO_LARGE', 'Refine attendance filters');
    await this.repo.transaction(async (tx) => {
      const l = tx.curriculum.learning,
        { u } = await this.learning.progressAuthority(l, user, batch);
      await this.learning.attendanceAuthority(l, user, batch);
      if (
        u.role !== 'SUPER_ADMIN' &&
        !(await l.students.admin.assignments(user)).some(
          (g) =>
            g.collegeId === b.collegeId &&
            g.status === 'ACTIVE' &&
            required.every((p) => g.permissions.includes(p as never)),
        )
      )
        denied();
      if (
        !(await l.students.admin.lockUser(user, u.sessionVersion)) ||
        !(await l.students.lockCollege(b.collegeId)) ||
        !(await l.lockBatch(batch))
      )
        throw new AppError(
          409,
          'REPORT_CHANGED',
          'Authority or Batch changed; retry',
        );
      await l.students.admin.audit({
        actorUserId: u.id,
        actorName: u.displayName,
        action: 'ATTENDANCE_REPORT_EXPORTED',
        targetType: 'BATCH',
        targetId: b.id,
        collegeId: b.collegeId,
        requestId,
        metadata: { after: 'PHASE_9_' + format, count: rows.length },
      });
    });
    return {
      filename: 'algora-attendance-analytics.' + format.toLowerCase(),
      ...file,
      rowCount: rows.length,
      summary,
    };
  }
  async personal(user: string, input: unknown) {
    const q = analyticsQuery.parse(input);
    if (
      q.collegeId ||
      q.courseId ||
      q.reason ||
      q.year ||
      q.search ||
      q.verification
    )
      throw new AppError(
        400,
        'INVALID_INPUT',
        'Personal analytics supports Batch, Day, platform and date filters',
      );
    await this.repo.ensureReady();
    const { p } = await this.coding.student(this.repo.read, user);
    const rows = [];
    for (let page = 1; page <= 5; page++) {
      const r = await this.repo.read.curriculum.learning.ownEnrollments(
        p.id,
        listSchema.parse({ page, pageSize: 20 }),
      );
      if (r.total > 100)
        throw new AppError(413, 'ANALYTICS_TOO_LARGE', 'Select a Batch');
      rows.push(...r.items);
      if (page >= r.totalPages) break;
    }
    if (q.batchId && !rows.some((e) => e.batchId === q.batchId)) denied();
    const batches = [];
    let sum = 0;
    for (const e of rows) {
      if (q.batchId && e.batchId !== q.batchId) continue;
      if (e.status !== 'ACTIVE') continue;
      try {
        const { current, projection, accounts } =
          await this.coding.personalData(user, e.batchId, {
            day: q.day,
            platform: q.platform,
            from: q.from,
            to: q.to,
          });
        sum += projection.items.length;
        if (sum > 20000)
          throw new AppError(413, 'ANALYTICS_TOO_LARGE', 'Select a Batch');
        const attendance = await this.source.attendance(e.batchId, q, p.id),
          marks = attendanceRows(attendance, p.id);
        const revision = current.batch.curriculumRevisionId,
          c = this.repo.read.curriculum;
        const frozen = revision ? await c.allFrozenDays(revision) : [],
          controls = revision ? await c.releases(e.batchId, revision) : [];
        const releasedDays = frozen.filter(
          (d) =>
            released(d, this.now()) &&
            !controls.some((r) => r.dayId === d.id && r.restricted),
        );
        const personalDays = releasedDays
          .filter((d) => !q.day || d.dayNumber === q.day)
          .map((d) => ({
            id: d.id,
            day: d.dayNumber,
            title: d.title,
            coding: codingMetrics(
              projection.items.filter((a) => a.dayNumber === d.dayNumber),
            ),
          }));
        batches.push({
          id: current.batch.id,
          name: current.batch.name,
          courseId: current.batch.courseId,
          course: current.batch.snapshot.title,
          status: current.batch.status,
          coding: codingMetrics(projection.items),
          days: personalDays,
          currentDay:
            Math.max(0, ...releasedDays.map((d) => d.dayNumber)) || null,
          assignments: projection.items.map((a) => ({
            id: a.id,
            day: a.dayNumber,
            title: a.title,
            url: a.url,
            platform: a.platform,
            status: a.status,
          })),
          attendance: attendanceMetrics(marks),
          morning: attendanceMetrics(marks.filter((m) => m.type === 'MORNING')),
          afternoon: attendanceMetrics(
            marks.filter((m) => m.type === 'AFTERNOON'),
          ),
          history: marks,
          accounts: accounts.map((a) => ({
            platform: a.platform,
            status: a.status,
            proofExpired: a.proofExpired,
            syncStatus: a.syncStatus,
            lastSuccess: a.lastSuccessAt,
            lastError: a.lastError,
          })),
          lastSuccess: latest(accounts.map((a) => a.lastSuccessAt)),
        });
      } catch (error) {
        if (
          error instanceof AppError &&
          [403, 404].includes(error.status) &&
          !q.batchId
        )
          continue;
        throw error;
      }
    }
    await this.coding.student(this.repo.read, user);
    const all = batches.flatMap((b) => b.assignments),
      marks = batches.flatMap((b) => b.history);
    return {
      generatedAt: this.now().toISOString(),
      summary: {
        enrolledCourses: new Set(batches.map((b) => b.courseId)).size,
        activeBatches: batches.filter((b) => b.status === 'ACTIVE').length,
        coding: codingMetrics(all),
        attendance: attendanceMetrics(marks),
      },
      batches,
    };
  }
}

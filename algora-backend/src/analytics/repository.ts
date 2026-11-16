import { attendanceStorageReady } from '../attendance/repository.js';
import { College } from '../models/college.js';
import { Course, Batch, BatchEnrollment } from '../models/learning.js';
import { StudentProfile } from '../models/student-profile.js';
import { User } from '../models/user.js';
import { AdminCollegeAssignment } from '../models/admin-college-assignment.js';
import {
  AttendanceSession,
  AttendanceRosterSnapshot,
  AttendanceRecord,
} from '../models/attendance.js';
import {
  StudentCodingAccount,
  StudentProblemProgress,
  CodingSyncJob,
} from '../models/coding.js';
import { AppError } from '../middleware/errors.js';
import type { CollegeRecord } from '../administration/contracts.js';
import type {
  BatchRecord,
  EnrollmentRecord,
  List,
} from '../learning/contracts.js';
import type { StudentProfileRecord } from '../students/contracts.js';
import type {
  Account,
  Progress,
  Job,
  ProgressUnit,
} from '../coding/contracts.js';
import type { UserRecord } from '../auth/types.js';
import type { AnalyticsQuery } from './contracts.js';
import type { AttendanceData } from './calculations.js';
export interface Catalog {
  colleges: CollegeRecord[];
  batches: BatchRecord[];
  profiles: StudentProfileRecord[];
  courses: number;
  authorizedAdmins: string[];
  enrollments: number;
}
export interface AnalyticsSource {
  catalog(scope: string[] | null, q: AnalyticsQuery): Promise<Catalog>;
  attendance(
    batch: string,
    q: AnalyticsQuery,
    student?: string,
  ): Promise<AttendanceData>;
  prepare(unit: ProgressUnit, batch: string): Promise<ProgressUnit>;
}
const dto = <T>(d: unknown): T => {
  const v = JSON.parse(JSON.stringify(d)) as Record<string, unknown>;
  const { _id, __v, ...rest } = v;
  void __v;
  return { ...rest, id: String(_id) } as T;
};
const bound = <T>(rows: T[], max: number) => {
  if (rows.length > max)
    throw new AppError(
      413,
      'ANALYTICS_TOO_LARGE',
      'Refine analytics filters to reduce the selected population',
    );
  return rows;
};
function page<T>(rows: T[], o: List) {
  return {
    items: rows.slice((o.page - 1) * o.pageSize, o.page * o.pageSize),
    total: rows.length,
    page: o.page,
    pageSize: o.pageSize,
    totalPages: Math.ceil(rows.length / o.pageSize),
  };
}
const extend = <T extends object>(base: T, overrides: Partial<T>): T =>
  Object.assign(Object.create(base) as T, overrides);
export const mongoAnalyticsSource: AnalyticsSource = {
  async catalog(scope, q) {
    const colleges = bound(
      (
        await College.find({
          ...(scope ? { _id: { $in: scope } } : {}),
          ...(q.collegeId ? { _id: q.collegeId } : {}),
        })
          .sort({ _id: 1 })
          .limit(501)
          .lean()
      ).map(dto<CollegeRecord>),
      500,
    );
    const ids = colleges.map((c) => c.id),
      f = {
        collegeId: { $in: ids },
        ...(q.courseId ? { courseId: q.courseId } : {}),
        ...(q.batchId ? { _id: q.batchId } : {}),
      };
    const batches = bound(
      (await Batch.find(f).sort({ _id: 1 }).limit(101).lean()).map(
        dto<BatchRecord>,
      ),
      100,
    );
    const profiles = bound(
      (
        await StudentProfile.find({ collegeId: { $in: ids } })
          .sort({ _id: 1 })
          .limit(10001)
          .lean()
      ).map(dto<StudentProfileRecord>),
      10000,
    );
    const assignments = await AdminCollegeAssignment.find({
      collegeId: { $in: ids },
      status: 'ACTIVE',
      permissions: 'college.view',
    })
      .select('collegeId adminUserId')
      .lean();
    const active = await User.find({
      _id: { $in: assignments.map((a) => a.adminUserId) },
      role: 'ADMIN',
      accountStatus: 'ACTIVE',
      emailVerified: true,
    })
      .select('_id')
      .lean();
    const activeIds = new Set(active.map((u) => String(u._id)));
    const courseFilter = {
      ...(q.courseId ? { _id: q.courseId } : {}),
      ...(scope || q.collegeId
        ? {
            $or: [
              { scope: 'PLATFORM' },
              { ownerCollegeId: { $in: ids } },
              { sharedCollegeIds: { $in: ids } },
            ],
          }
        : {}),
    };
    return {
      colleges,
      batches,
      profiles,
      courses: await Course.countDocuments(courseFilter),
      authorizedAdmins: [
        ...new Set(
          assignments
            .filter((a) => activeIds.has(String(a.adminUserId)))
            .map((a) => String(a.collegeId)),
        ),
      ],
      enrollments: await BatchEnrollment.countDocuments({
        batchId: { $in: batches.map((b) => b.id) },
        ...(q.year || q.search
          ? {
              studentProfileId: {
                $in: profiles
                  .filter(
                    (p) =>
                      (!q.year || p.yearOfStudy === q.year) &&
                      (!q.search ||
                        (p.fullName + ' ' + p.rollNumber)
                          .toLowerCase()
                          .includes(q.search.toLowerCase())),
                  )
                  .map((p) => p.id),
              },
            }
          : {}),
        status: {
          $in: ['ACTIVE', 'PENDING_REGISTRATION', 'PENDING_VERIFICATION'],
        },
      }),
    };
  },
  async attendance(batch, q, student) {
    if (!attendanceStorageReady())
      throw new AppError(
        503,
        'ANALYTICS_UNAVAILABLE',
        'Attendance storage is not ready',
      );
    const f = {
      batchId: batch,
      ...(q.day ? { dayNumber: q.day } : {}),
      ...(q.from
        ? { createdAt: { $gte: new Date(q.from), $lte: new Date(q.to!) } }
        : {}),
    };
    const sessions = bound(
      (
        await AttendanceSession.find(f)
          .sort({ dayNumber: 1, sessionType: 1, _id: 1 })
          .limit(1001)
          .lean()
      ).map(dto<AttendanceData['sessions'][number]>),
      1000,
    );
    const ids = sessions.map((s) => s.id),
      rf = {
        attendanceSessionId: { $in: ids },
        ...(student ? { studentProfileId: student } : {}),
      };
    const [roster, records] = await Promise.all([
      AttendanceRosterSnapshot.find(rf).limit(20001).lean(),
      AttendanceRecord.find(rf).limit(20001).lean(),
    ]);
    return {
      sessions,
      roster: bound(roster.map(dto<AttendanceData['roster'][number]>), 20000),
      records: bound(
        records.map(dto<AttendanceData['records'][number]>),
        20000,
      ),
    };
  },
  async prepare(unit, batch) {
    const l = unit.curriculum.learning,
      b = await l.batch(batch);
    if (!b) throw new AppError(404, 'NOT_FOUND', 'Batch not found');
    const enrollments = bound(
      (
        await BatchEnrollment.find({ batchId: batch })
          .sort({ createdAt: -1, _id: 1 })
          .limit(4001)
          .lean()
      ).map(dto<EnrollmentRecord>),
      4000,
    );
    const profileIds = enrollments.flatMap((e) =>
      e.studentProfileId ? [e.studentProfileId] : [],
    );
    const profiles = (
      await StudentProfile.find({ _id: { $in: profileIds } }).lean()
    ).map(dto<StudentProfileRecord>);
    const [us, ac, pr, js, c, college] = await Promise.all([
      User.find({ _id: { $in: profiles.map((p) => p.userId) } })
        .select('-email -googleSubject -avatarUrl')
        .lean(),
      StudentCodingAccount.find({
        studentProfileId: { $in: profileIds },
      }).lean(),
      StudentProblemProgress.find({ batchId: batch }).limit(20001).lean(),
      CodingSyncJob.aggregate([
        {
          $match: {
            batchId: batch,
            studentProfileId: {
              $in: profileIds,
            },
          },
        },
        { $sort: { createdAt: -1, _id: 1 } },
        {
          $group: {
            _id: '$accountId',
            rows: { $firstN: { input: '$$ROOT', n: 20 } },
          },
        },
        { $project: { rows: { $slice: ['$rows', 20] } } },
        { $unwind: '$rows' },
        { $replaceRoot: { newRoot: '$rows' } },
        { $limit: 40001 },
      ]),
      l.course(b.courseId),
      l.students.admin.college(b.collegeId),
    ]);
    const users = new Map(
        us.map((u) => {
          const v = dto<UserRecord>(u);
          return [v.id, v];
        }),
      ),
      ps = new Map(profiles.map((p) => [p.id, p])),
      accounts = ac.map(dto<Account>),
      progress = bound(pr.map(dto<Progress>), 20000),
      jobs = bound(js.map(dto<Job>), 40000);
    const curr = enrollments.filter((e) =>
      ['ACTIVE', 'PENDING_REGISTRATION', 'PENDING_VERIFICATION'].includes(
        e.status,
      ),
    );
    const admin = extend(l.students.admin, {
      user: async (id) => users.get(id) ?? l.students.admin.user(id),
      college: async (id) =>
        id === b.collegeId ? college : l.students.admin.college(id),
    });
    const students = extend(l.students, {
      admin,
      profile: async (id) => ps.get(id) ?? null,
      own: async (id) => profiles.find((p) => p.userId === id) ?? null,
    });
    const learning = extend(l, {
      students,
      batch: async (id) => (id === batch ? b : l.batch(id)),
      course: async (id) => (id === b.courseId ? c : l.course(id)),
      enrollments: async (id, o, history) =>
        id === batch
          ? page(history ? enrollments : curr, o)
          : l.enrollments(id, o, history),
      ownEnrollments: async (id, o) =>
        page(
          curr.filter((e) => e.studentProfileId === id),
          o,
        ),
      current: async (id, roll, p) =>
        id === batch
          ? (curr.find(
              (e) => e.rollNumber === roll || (p && e.studentProfileId === p),
            ) ?? null)
          : l.current(id, roll, p),
    });
    const days = b.curriculumRevisionId
        ? await unit.curriculum.allFrozenDays(b.curriculumRevisionId)
        : [],
      releases = b.curriculumRevisionId
        ? await unit.curriculum.releases(batch, b.curriculumRevisionId)
        : [];
    return extend(unit, {
      curriculum: extend(unit.curriculum, {
        learning,
        allFrozenDays: async (id) =>
          id === b.curriculumRevisionId
            ? days
            : unit.curriculum.allFrozenDays(id),
        releases: async (id, revision) =>
          id === batch && revision === b.curriculumRevisionId
            ? releases
            : unit.curriculum.releases(id, revision),
      }),
      accounts: async (p) => accounts.filter((a) => a.studentProfileId === p),
      progress: async (p, id, e) =>
        progress.filter(
          (r) =>
            r.studentProfileId === p &&
            r.batchId === id &&
            r.enrollmentId === e,
        ),
      jobs: async (a, id) =>
        jobs.filter((j) => j.accountId === a && (!id || j.batchId === id)),
    });
  },
};

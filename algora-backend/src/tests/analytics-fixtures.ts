import { AnalyticsService } from '../analytics/service.js';
import { setupCoding } from './coding-fixtures.js';
import type { AnalyticsSource } from '../analytics/repository.js';
export async function setupAnalytics() {
  const f = await setupCoding(),
    l = f.repo.curriculum.learning;
  const source: AnalyticsSource = {
    prepare: async (unit) => unit,
    catalog: async (scope, q) => {
      const colleges = [...l.students.admin.colleges.values()].filter(
        (c) =>
          (!scope || scope.includes(c.id)) &&
          (!q.collegeId || c.id === q.collegeId),
      );
      const ids = new Set(colleges.map((c) => c.id)),
        batches = [...l.batches.values()].filter(
          (b) =>
            ids.has(b.collegeId) &&
            (!q.courseId || b.courseId === q.courseId) &&
            (!q.batchId || b.id === q.batchId),
        );
      return {
        colleges,
        batches,
        profiles: [...l.students.profiles.values()].filter((p) =>
          ids.has(p.collegeId),
        ),
        courses: l.courses.size,
        authorizedAdmins: [f.college],
        enrollments: [...l.enrollments.values()].filter(
          (e) =>
            batches.some((b) => b.id === e.batchId) &&
            ((!q.year && !q.search) ||
              [...l.students.profiles.values()].some(
                (p) =>
                  p.id === e.studentProfileId &&
                  (!q.year || p.yearOfStudy === q.year) &&
                  (!q.search ||
                    (p.fullName + ' ' + p.rollNumber)
                      .toLowerCase()
                      .includes(q.search.toLowerCase())),
              )) &&
            ['ACTIVE', 'PENDING_REGISTRATION', 'PENDING_VERIFICATION'].includes(
              e.status,
            ),
        ).length,
      };
    },
    attendance: async (batch, q, student) => {
      const sessions = [...f.attendanceRepo.sessions.values()].filter(
          (s) =>
            s.batchId === batch &&
            (!q.day || s.dayNumber === q.day) &&
            (!q.from || s.createdAt >= q.from) &&
            (!q.to || s.createdAt <= q.to),
        ),
        ids = new Set(sessions.map((s) => s.id));
      return {
        sessions,
        roster: [...f.attendanceRepo.rosterRows.values()].filter(
          (r) =>
            ids.has(r.attendanceSessionId) &&
            (!student || r.studentProfileId === student),
        ),
        records: [...f.attendanceRepo.rows.values()].filter(
          (r) =>
            ids.has(r.attendanceSessionId) &&
            (!student || r.studentProfileId === student),
        ),
      };
    },
  };
  const service = new AnalyticsService(
    f.service,
    f.learning,
    f.repo,
    source,
    f.getNow,
  );
  return { ...f, analytics: service, source };
}

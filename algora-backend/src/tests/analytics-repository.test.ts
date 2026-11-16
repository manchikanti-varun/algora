import { it, expect, vi, afterEach } from 'vitest';
import { setupCoding } from './coding-fixtures.js';
import { mongoAnalyticsSource } from '../analytics/repository.js';
import { BatchEnrollment } from '../models/learning.js';
import { StudentProfile } from '../models/student-profile.js';
import { User } from '../models/user.js';
import {
  StudentCodingAccount,
  StudentProblemProgress,
  CodingSyncJob,
} from '../models/coding.js';
import { reportMetrics } from '../coding/reports.js';
afterEach(() => vi.restoreAllMocks());
const docs = <T extends { id: string }>(values: Iterable<T>) =>
  [...values].map((v) => ({ ...v, _id: v.id }));
function query(value: unknown) {
  return {
    sort() {
      return this;
    },
    limit() {
      return this;
    },
    select() {
      return this;
    },
    lean: async () => structuredClone(value),
  };
}
it('prepares 120 Students using bounded bulk reads and the actual String job reference schema', async () => {
  const f = await setupCoding();
  for (let i = 1; i < 120; i++) await f.addStudent();
  const account = await f.link();
  await f.verify(account.id);
  await f.queue();
  await f.service.processOne();
  const l = f.repo.curriculum.learning;
  const enrollments = vi
    .spyOn(BatchEnrollment, 'find')
    .mockReturnValue(query(docs(l.enrollments.values())) as never);
  const profiles = vi
    .spyOn(StudentProfile, 'find')
    .mockReturnValue(query(docs(l.students.profiles.values())) as never);
  const users = vi
    .spyOn(User, 'find')
    .mockReturnValue(
      query(
        docs(
          [...l.students.admin.auth.users.values()].filter(
            (u) => u.role === 'STUDENT',
          ),
        ),
      ) as never,
    );
  const accounts = vi
    .spyOn(StudentCodingAccount, 'find')
    .mockReturnValue(query(docs(f.repo.accounts.values())) as never);
  const progress = vi
    .spyOn(StudentProblemProgress, 'find')
    .mockReturnValue(query(docs(f.repo.rows.values())) as never);
  const jobs = vi
    .spyOn(CodingSyncJob, 'aggregate')
    .mockResolvedValue(docs(f.repo.jobs.values()));
  const unit = await mongoAnalyticsSource.prepare(f.repo.read, f.batch),
    data = await f.service.reportData(f.owner.id, f.batch, {}, unit);
  expect(CodingSyncJob.schema.path('batchId').instance).toBe('String');
  expect(CodingSyncJob.schema.path('studentProfileId').instance).toBe('String');
  const pipeline = jobs.mock.calls[0]![0]!;
  expect(pipeline[0]).toMatchObject({ $match: { batchId: f.batch } });
  const match = (
    pipeline[0] as { $match: { studentProfileId: { $in: string[] } } }
  ).$match;
  expect(match.studentProfileId.$in).toHaveLength(120);
  expect(match.studentProfileId.$in.every((id) => typeof id === 'string')).toBe(
    true,
  );
  expect(pipeline).toContainEqual({
    $group: {
      _id: '$accountId',
      rows: { $firstN: { input: '$$ROOT', n: 20 } },
    },
  });
  expect(pipeline).toContainEqual({ $limit: 40001 });
  expect(data.students).toHaveLength(120);
  expect(reportMetrics(data.rows)).toMatchObject({
    assigned: 120,
    solved: 1,
    unavailable: 119,
  });
  for (const read of [enrollments, profiles, users, accounts, progress, jobs])
    expect(read).toHaveBeenCalledTimes(1);
}, 60000);

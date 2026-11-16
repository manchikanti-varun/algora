import { afterEach, it, expect, vi } from 'vitest';
import mongoose, { type ClientSession } from 'mongoose';
import {
  mongoProgressRepository,
  MongoProgressUnit,
} from '../coding/repository.js';
import {
  CodingSyncJob,
  CodingProviderControl,
  SubmissionEvidence,
  StudentCodingAccount,
  StudentProblemProgress,
} from '../models/coding.js';
import { StudentProfile } from '../models/student-profile.js';
import { BatchEnrollment } from '../models/learning.js';
import { AuditLog } from '../models/audit-log.js';
import { newId } from './administration-fixtures.js';
afterEach(() => vi.restoreAllMocks());
it('fails closed without configured/initialized MongoDB progress storage', async () => {
  await expect(mongoProgressRepository.ensureReady()).rejects.toMatchObject({
    code: 'STORAGE_UNAVAILABLE',
  });
});
it('shares snapshot/majority transaction sessions across profile, enrollment and audit locks', async () => {
  vi.spyOn(mongoProgressRepository, 'ensureReady').mockResolvedValue();
  const session = {} as ClientSession,
    transaction = vi
      .spyOn(mongoose.connection, 'transaction')
      .mockImplementation(async (work) => work(session)),
    profile = vi
      .spyOn(StudentProfile, 'updateOne')
      .mockResolvedValue({ matchedCount: 1 } as never),
    enrollment = vi
      .spyOn(BatchEnrollment, 'updateOne')
      .mockResolvedValue({ matchedCount: 1 } as never),
    audit = vi.spyOn(AuditLog, 'create').mockResolvedValue([] as never);
  await mongoProgressRepository.transaction(async (tx) => {
    expect(await tx.lockEligibility(newId(), newId())).toBe(true);
    await tx.curriculum.learning.students.admin.audit({
      actorUserId: newId(),
      actorName: 'Reviewer',
      action: 'CODING_PROGRESS_RECONCILED',
      targetType: 'CODING_PROGRESS',
      targetId: newId(),
      metadata: { count: 1 },
      requestId: 'test',
    });
  });
  expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
    readConcern: { level: 'snapshot' },
    writeConcern: { w: 'majority' },
  });
  expect(profile).toHaveBeenCalledWith(
    expect.any(Object),
    { $inc: { attendanceRevision: 1 } },
    expect.objectContaining({ session }),
  );
  expect(enrollment).toHaveBeenCalledWith(
    expect.objectContaining({ status: 'ACTIVE' }),
    expect.any(Object),
    expect.objectContaining({ session }),
  );
  expect(audit).toHaveBeenCalledWith(
    expect.any(Array),
    expect.objectContaining({ session }),
  );
});
it('claims due or expired work atomically with a lease and fencing token', async () => {
  const claim = vi
    .spyOn(CodingSyncJob, 'findOneAndUpdate')
    .mockResolvedValue(null);
  const now = new Date().toISOString();
  await mongoProgressRepository.claim(now, 'unique-worker-token');
  expect(claim).toHaveBeenCalledWith(
    expect.objectContaining({ active: true, $or: expect.any(Array) }),
    expect.objectContaining({
      $set: expect.objectContaining({
        leaseToken: 'unique-worker-token',
        status: 'RUNNING',
      }),
      $inc: { attempts: 1 },
    }),
    expect.objectContaining({ new: true, sort: { nextAt: 1 } }),
  );
});
it('uses MongoDB as the shared global provider lock', async () => {
  const reserve = vi
    .spyOn(CodingProviderControl, 'findOneAndUpdate')
    .mockResolvedValue(null);
  await mongoProgressRepository.reserveProvider(
    new Date().toISOString(),
    'worker',
  );
  expect(reserve).toHaveBeenCalledWith(
    expect.objectContaining({ _id: 'codeforces', $expr: expect.any(Object) }),
    expect.arrayContaining([
      expect.objectContaining({
        $set: expect.objectContaining({
          token: 'worker',
          leaseUntil: expect.any(Object),
          nextAllowedAt: expect.any(Object),
        }),
      }),
    ]),
    { new: true },
  );
});
it('prevents a stale worker from completing a different lease', async () => {
  const save = vi
    .spyOn(CodingSyncJob, 'findOneAndUpdate')
    .mockResolvedValue(null);
  const unit = new MongoProgressUnit();
  await unit.saveJob(
    { id: newId(), status: 'SUCCEEDED', active: false } as never,
    'stale',
  );
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({
      active: true,
      status: 'RUNNING',
      leaseToken: 'stale',
      leaseUntil: expect.any(Object),
    }),
    expect.any(Object),
    expect.any(Object),
  );
});
it('enforces unique trusted subject/handle binding and membership-scoped progress indexes', () => {
  expect(StudentCodingAccount.schema.indexes()).toContainEqual([
    { platform: 1, subject: 1 },
    expect.objectContaining({
      unique: true,
      partialFilterExpression: expect.objectContaining({
        active: true,
        status: 'VERIFIED',
      }),
    }),
  ]);
  expect(
    StudentProblemProgress.schema
      .indexes()
      .some(
        ([fields, options]) =>
          fields.enrollmentId === 1 &&
          fields.assignmentId === 1 &&
          options.unique,
      ),
  ).toBe(true);
  expect(
    SubmissionEvidence.schema
      .indexes()
      .some(
        ([fields, options]) =>
          fields.accountRevision === 1 &&
          fields.digest === 1 &&
          fields.assignmentId === 1 &&
          options.unique,
      ),
  ).toBe(true);
});
it.each([
  'updateMany',
  'findOneAndUpdate',
  'replaceOne',
  'findOneAndReplace',
  'deleteOne',
  'deleteMany',
  'findOneAndDelete',
] as const)(
  'rejects %s against immutable submission evidence',
  async (method) => {
    await expect(
      SubmissionEvidence[method]({}, { $set: { verdict: 'OK' } }).exec(),
    ).rejects.toThrow('Immutable coding evidence');
  },
);
it('rejects updateOne mutations while allowing only guarded append/upsert', async () => {
  await expect(
    SubmissionEvidence.updateOne({}, { $set: { verdict: 'OK' } }).exec(),
  ).rejects.toThrow('Immutable coding evidence');
  expect(SubmissionEvidence.schema.get('timestamps')).toBe(false);
});

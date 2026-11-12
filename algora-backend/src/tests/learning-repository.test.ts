import { afterEach, it, expect, vi } from 'vitest';
import mongoose, { type ClientSession } from 'mongoose';
import {
  MongoLearningUnit,
  mongoLearningRepository,
} from '../learning/repository.js';
import { MongoStudentUnit } from '../students/repository.js';
import { MongoAdminUnit } from '../administration/repository.js';
import {
  Batch,
  BatchEnrollment,
  EnrollmentImport,
} from '../models/learning.js';
import { StudentProfile } from '../models/student-profile.js';
import { User } from '../models/user.js';
import { College } from '../models/college.js';
import { newId } from './administration-fixtures.js';
import { reconciliationPending } from '../learning/markers.js';
afterEach(() => vi.restoreAllMocks());
it('shares the MongoDB session across student, administration and enrollment writes', async () => {
  vi.spyOn(mongoLearningRepository, 'ensureReady').mockResolvedValue();
  const session = {} as ClientSession;
  const transaction = vi
    .spyOn(mongoose.connection, 'transaction')
    .mockImplementation(async (work) => work(session));
  const seat = vi
    .spyOn(Batch, 'updateOne')
    .mockResolvedValue({ modifiedCount: 1 } as never);
  await mongoLearningRepository.transaction(async (tx) => {
    expect(tx).toBeInstanceOf(MongoLearningUnit);
    expect(tx.students).toBeInstanceOf(MongoStudentUnit);
    expect(tx.students.admin).toBeInstanceOf(MongoAdminUnit);
    expect(await tx.seat(newId(), 1)).toBe(true);
  });
  expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
    readConcern: { level: 'snapshot' },
    writeConcern: { w: 'majority' },
  });
  expect(seat).toHaveBeenCalledWith(
    expect.objectContaining({
      status: { $in: ['DRAFT', 'ACTIVE'] },
      $or: [
        { capacity: null },
        { $expr: { $lt: ['$seatCount', '$capacity'] } },
      ],
    }),
    { $inc: { seatCount: 1, operationalRevision: 1 } },
    expect.objectContaining({ session }),
  );
});
it('updates memberships by revision and persists completed import results in the same session', async () => {
  const session = {} as ClientSession,
    unit = new MongoLearningUnit(session),
    id = newId();
  const update = vi
      .spyOn(BatchEnrollment, 'findOneAndUpdate')
      .mockResolvedValue(null),
    complete = vi
      .spyOn(EnrollmentImport, 'updateOne')
      .mockResolvedValue({} as never);
  await unit.updateEnrollment(id, 4, { status: 'WITHDRAWN' });
  await unit.completeImport(id, []);
  expect(update).toHaveBeenCalledWith(
    { _id: id, revision: 4 },
    { $set: { status: 'WITHDRAWN' }, $inc: { revision: 1 } },
    expect.objectContaining({ session, runValidators: true }),
  );
  expect(complete).toHaveBeenCalledWith(
    { _id: id, status: 'PREVIEW' },
    { $set: { status: 'COMPLETED', results: [] } },
    expect.objectContaining({ session }),
  );
});
it('marks identity and college changes durably within their original writes', async () => {
  const session = {} as ClientSession,
    id = newId(),
    profile = vi
      .spyOn(StudentProfile, 'findOneAndUpdate')
      .mockResolvedValue(null);
  await new MongoStudentUnit(session).update(id, 2, {
    rollNumber: '24CS001A12',
  });
  expect(profile).toHaveBeenCalledWith(
    { _id: id, revision: 2 },
    expect.objectContaining({
      $set: expect.objectContaining({
        rollNumber: '24CS001A12',
        enrollmentReconciliationPending: true,
        reconciliationToken: expect.any(String),
        reconciliationAttempts: 0,
      }),
    }),
    expect.objectContaining({ session }),
  );
  const update = vi.spyOn(College, 'findOneAndUpdate').mockResolvedValue(null);
  const unit = new MongoAdminUnit(session);
  vi.spyOn(unit, 'college').mockResolvedValue({
    id,
    name: 'College',
    city: '',
    state: '',
    country: '',
    code: 'TEST',
    slug: 'test',
    status: 'ACTIVE',
    revision: 0,
    createdBy: id,
    updatedBy: id,
    createdAt: '',
    updatedAt: '',
  });
  await unit.updateCollege(id, 0, { status: 'INACTIVE' }, id);
  expect(update).toHaveBeenCalledWith(
    { _id: id, revision: 0 },
    expect.objectContaining({
      $set: expect.objectContaining({
        status: 'INACTIVE',
        enrollmentReconciliationPending: true,
      }),
    }),
    expect.objectContaining({ session }),
  );
});
it('declares indexed durable markers on all relevant source entities', () => {
  for (const model of [User, College, StudentProfile, Batch]) {
    expect(model.schema.path('enrollmentReconciliationPending')).toBeDefined();
    expect(model.schema.path('reconciliationAttempts')).toBeDefined();
    expect(
      model.schema
        .indexes()
        .some(
          ([fields]) =>
            fields.enrollmentReconciliationPending === 1 &&
            fields.reconciliationNextAt === 1,
        ),
    ).toBe(true);
  }
  const a = reconciliationPending(),
    b = reconciliationPending();
  expect(a.reconciliationToken).not.toBe(b.reconciliationToken);
  expect(a.reconciliationNextAt.getTime()).toBe(0);
});

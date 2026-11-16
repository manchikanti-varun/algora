import { afterEach, it, expect, vi } from 'vitest';
import mongoose, { type ClientSession } from 'mongoose';
import {
  MongoStudentUnit,
  mongoStudentRepository,
} from '../students/repository.js';
import {
  StudentProfile,
  StudentRollReservation,
} from '../models/student-profile.js';
import { StudentQrCredential } from '../models/student-qr-credential.js';
import { College } from '../models/college.js';
import { QrVault } from '../students/crypto.js';
import { randomBytes } from 'node:crypto';
import { newId } from './administration-fixtures.js';
afterEach(() => vi.restoreAllMocks());
it('uses one real snapshot/majority transaction for student and existing administration units', async () => {
  vi.spyOn(mongoStudentRepository, 'ensureReady').mockResolvedValue();
  const session = {} as ClientSession;
  const tx = vi
    .spyOn(mongoose.connection, 'transaction')
    .mockImplementation(async (work) => work(session));
  const lock = vi
    .spyOn(College, 'updateOne')
    .mockResolvedValue({ modifiedCount: 1 } as never);
  await mongoStudentRepository.transaction(async (unit) => {
    expect(unit).toBeInstanceOf(MongoStudentUnit);
    await unit.lockCollege(newId());
  });
  expect(tx).toHaveBeenCalledWith(expect.any(Function), {
    readConcern: { level: 'snapshot' },
    writeConcern: { w: 'majority' },
  });
  expect(lock).toHaveBeenCalledWith(
    expect.objectContaining({ status: 'ACTIVE' }),
    { $inc: { operationalRevision: 1 } },
    { session },
  );
});
it('clears obsolete verification metadata using $unset under revision CAS', async () => {
  const session = {} as ClientSession;
  const update = vi
    .spyOn(StudentProfile, 'findOneAndUpdate')
    .mockResolvedValue(null);
  const id = newId();
  await new MongoStudentUnit(session).update(id, 3, {
    verificationStatus: 'PENDING_VERIFICATION',
    verifiedAt: undefined,
    verificationEvidence: undefined,
  });
  expect(update).toHaveBeenCalledWith(
    { _id: id, revision: 3 },
    {
      $set: expect.objectContaining({
        verificationStatus: 'PENDING_VERIFICATION',
        enrollmentReconciliationPending: true,
      }),
      $unset: { verifiedAt: 1, verificationEvidence: 1 },
      $inc: { revision: 1 },
    },
    expect.objectContaining({ session, new: true, runValidators: true }),
  );
});
it('retains immutable unique roll reservations and replaces the single indexed QR lookup hash', async () => {
  const session = {} as ClientSession;
  const reserve = vi
    .spyOn(StudentRollReservation, 'updateOne')
    .mockResolvedValue({} as never);
  const qr = vi
    .spyOn(StudentQrCredential, 'updateOne')
    .mockResolvedValue({} as never);
  const unit = new MongoStudentUnit(session),
    id = newId();
  await unit.reserveRoll('23A91A05B2', id);
  expect(reserve).toHaveBeenCalledWith(
    { rollNumber: '23A91A05B2', profileId: id },
    { $setOnInsert: { rollNumber: '23A91A05B2', profileId: id } },
    expect.objectContaining({ upsert: true, session }),
  );
  const credential = new QrVault(
    'test',
    JSON.stringify({ test: randomBytes(32).toString('base64') }),
  ).issue(id, 2);
  await unit.putCredential(credential);
  expect(qr).toHaveBeenCalledWith(
    { profileId: id },
    { $set: credential },
    expect.objectContaining({ session, upsert: true, runValidators: true }),
  );
  expect(credential).not.toHaveProperty('token');
});

it('year-only updates do not enqueue enrollment reconciliation or touch immutable identity', async () => {
  const update = vi
    .spyOn(StudentProfile, 'findOneAndUpdate')
    .mockResolvedValue(null);
  await new MongoStudentUnit().update(newId(), 2, { yearOfStudy: 4 });
  const change = update.mock.calls[0]?.[1] as {
    $set: Record<string, unknown>;
    $inc: Record<string, number>;
  };
  expect(change.$set).toEqual({ yearOfStudy: 4 });
  expect(change.$inc).toEqual({ revision: 1 });
  expect(change.$set).not.toHaveProperty('enrollmentReconciliationPending');
});

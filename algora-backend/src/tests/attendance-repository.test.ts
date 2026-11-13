import { afterEach, it, expect, vi } from 'vitest';
import mongoose, { type ClientSession } from 'mongoose';
import {
  MongoAttendanceUnit,
  mongoAttendanceRepository,
} from '../attendance/repository.js';
import { MongoCurriculumUnit } from '../curriculum/repository.js';
import { AttendanceSession, AttendanceRecord } from '../models/attendance.js';
import { StudentProfile } from '../models/student-profile.js';
import { StudentQrCredential } from '../models/student-qr-credential.js';
import { BatchEnrollment } from '../models/learning.js';
import { AuditLog } from '../models/audit-log.js';
import { newId } from './administration-fixtures.js';
afterEach(() => vi.restoreAllMocks());
it('shares snapshot/majority transaction sessions with curriculum, authority and audit writes', async () => {
  vi.spyOn(mongoAttendanceRepository, 'ensureReady').mockResolvedValue();
  const session = {} as ClientSession,
    transaction = vi
      .spyOn(mongoose.connection, 'transaction')
      .mockImplementation(async (work) => work(session)),
    lock = vi
      .spyOn(AttendanceSession, 'updateOne')
      .mockResolvedValue({ modifiedCount: 1 } as never),
    audit = vi.spyOn(AuditLog, 'create').mockResolvedValue([] as never);
  await mongoAttendanceRepository.transaction(async (tx) => {
    expect(tx.curriculum).toBeInstanceOf(MongoCurriculumUnit);
    await tx.lockSession(newId(), 4, 'OPEN');
    await tx.curriculum.learning.students.admin.audit({
      actorUserId: newId(),
      actorName: 'Example Reviewer',
      action: 'ATTENDANCE_QR_MARKED',
      targetType: 'ATTENDANCE_SESSION',
      targetId: newId(),
      requestId: 'test',
      metadata: { count: 1 },
    });
  });
  expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
    readConcern: { level: 'snapshot' },
    writeConcern: { w: 'majority' },
  });
  expect(lock).toHaveBeenCalledWith(
    expect.objectContaining({ status: 'OPEN', revision: 4 }),
    { $inc: { operationalRevision: 1 } },
    expect.objectContaining({ session }),
  );
  expect(audit).toHaveBeenCalledWith(
    expect.any(Array),
    expect.objectContaining({ session }),
  );
});
it('locks current profile, enrollment and QR version/hash in the same MongoDB session', async () => {
  const session = {} as ClientSession,
    id = newId(),
    user = newId(),
    enrollment = newId(),
    college = newId(),
    unit = new MongoAttendanceUnit(session);
  const profile = vi
      .spyOn(StudentProfile, 'updateOne')
      .mockResolvedValue({ modifiedCount: 1 } as never),
    link = vi
      .spyOn(BatchEnrollment, 'updateOne')
      .mockResolvedValue({ modifiedCount: 1 } as never),
    qr = vi
      .spyOn(StudentQrCredential, 'updateOne')
      .mockResolvedValue({ modifiedCount: 1 } as never);
  expect(
    await unit.lockIdentity(
      {
        id,
        userId: user,
        revision: 3,
        qrCredentialVersion: 2,
        rollNumber: 'R000000001',
        collegeId: college,
      } as never,
      { id: enrollment, revision: 4 } as never,
      'a'.repeat(64),
    ),
  ).toBe(true);
  expect(profile).toHaveBeenCalledWith(
    expect.objectContaining({
      _id: id,
      revision: 3,
      verificationStatus: 'VERIFIED',
      qrCredentialVersion: 2,
    }),
    expect.any(Object),
    expect.objectContaining({ session }),
  );
  expect(link).toHaveBeenCalledWith(
    expect.objectContaining({
      _id: enrollment,
      revision: 4,
      status: 'ACTIVE',
      studentProfileId: id,
      rollNumber: 'R000000001',
    }),
    expect.any(Object),
    expect.objectContaining({ session }),
  );
  expect(qr).toHaveBeenCalledWith(
    { profileId: id, version: 2, tokenHash: 'a'.repeat(64) },
    expect.any(Object),
    expect.objectContaining({ session }),
  );
});
it('resolves only the existing current QR lookup hash without encrypted material', async () => {
  const select = vi.fn(() => ({ session: async () => null }));
  vi.spyOn(StudentQrCredential, 'findOne').mockReturnValue({ select } as never);
  expect(
    await new MongoAttendanceUnit().credentialByHash('b'.repeat(64)),
  ).toBeNull();
  expect(select).toHaveBeenCalledWith('profileId version tokenHash');
});
it('guards lifecycle writes by session ID, state and expected revision', async () => {
  const session = {} as ClientSession,
    id = newId(),
    change = vi
      .spyOn(AttendanceSession, 'findOneAndUpdate')
      .mockResolvedValue(null);
  await new MongoAttendanceUnit(session).changeSession(id, 2, 'CLOSED', {
    status: 'FINALIZED',
  });
  expect(change).toHaveBeenCalledWith(
    { _id: id, revision: 2, status: 'CLOSED' },
    {
      $set: { status: 'FINALIZED' },
      $inc: { revision: 1, operationalRevision: 1 },
    },
    expect.objectContaining({ session, runValidators: true }),
  );
});
it('corrections include the immutable session relationship and record revision', async () => {
  const id = newId(),
    sessionId = newId(),
    unit = new MongoAttendanceUnit();
  vi.spyOn(unit, 'record').mockResolvedValue({
    id,
    attendanceSessionId: sessionId,
  } as never);
  const update = vi
    .spyOn(AttendanceRecord, 'findOneAndUpdate')
    .mockResolvedValue(null);
  await unit.updateRecord(id, 3, {
    status: 'PRESENT',
    source: 'ADMIN_CORRECTION',
    updatedBy: newId(),
  });
  expect(update).toHaveBeenCalledWith(
    { _id: id, revision: 3, attendanceSessionId: sessionId },
    expect.objectContaining({ $inc: { revision: 1 } }),
    expect.any(Object),
  );
});
it('reads a Student record only through its session/profile compound identity', async () => {
  const session = newId(),
    profile = newId(),
    find = vi
      .spyOn(AttendanceRecord, 'findOne')
      .mockReturnValue({ session: async () => null } as never);
  expect(
    await new MongoAttendanceUnit().ownRecord(session, profile),
  ).toBeNull();
  expect(find).toHaveBeenCalledWith({
    attendanceSessionId: session,
    studentProfileId: profile,
  });
});
it('paginates historical Student sessions in the database with a self-only roster lookup', async () => {
  const profile = newId(),
    batch = newId(),
    aggregate = vi.spyOn(AttendanceSession, 'aggregate').mockReturnValue({
      session: async () => [{ items: [], total: [] }],
    } as never);
  const result = await new MongoAttendanceUnit().ownSessions(batch, profile, {
    page: 3,
    pageSize: 10,
    search: '',
  });
  expect(result.items).toEqual([]);
  const pipeline = aggregate.mock.calls[0][0] as Record<string, unknown>[];
  expect(pipeline[0]).toEqual({ $match: { batchId: batch } });
  expect(JSON.stringify(pipeline)).toContain(profile);
  expect(pipeline[pipeline.length - 1]).toEqual({
    $facet: {
      items: [{ $skip: 20 }, { $limit: 10 }],
      total: [{ $count: 'value' }],
    },
  });
});
it('rejects oversized session report sets before loading their rosters', async () => {
  const chain = {
    sort: () => chain,
    limit: () => chain,
    session: async () =>
      Array.from({ length: 1001 }, () => ({
        toObject: () => ({ _id: newId() }),
      })),
  };
  vi.spyOn(AttendanceSession, 'find').mockReturnValue(chain as never);
  await expect(
    new MongoAttendanceUnit().reportSessions(newId(), {
      page: 1,
      pageSize: 10,
      search: '',
    }),
  ).rejects.toMatchObject({ code: 'ATTENDANCE_LIMIT' });
});

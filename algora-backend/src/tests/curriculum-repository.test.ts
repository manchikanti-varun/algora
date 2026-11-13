import { afterEach, it, expect, vi } from 'vitest';
import mongoose, { type ClientSession } from 'mongoose';
import {
  MongoCurriculumUnit,
  mongoCurriculumRepository,
} from '../curriculum/repository.js';
import {
  CurriculumRevision,
  EditorialRevision,
  LearningDay,
  PublishedLearningDay,
} from '../models/curriculum.js';
import { MongoLearningUnit } from '../learning/repository.js';
import { AuditLog } from '../models/audit-log.js';
import { newId } from './administration-fixtures.js';
afterEach(() => vi.restoreAllMocks());
it('shares the same transaction session with Phase 5 authority and audit writes', async () => {
  const session = {} as ClientSession;
  vi.spyOn(mongoCurriculumRepository, 'ensureReady').mockResolvedValue();
  const transaction = vi
    .spyOn(mongoose.connection, 'transaction')
    .mockImplementation(async (work) => work(session));
  const update = vi
      .spyOn(CurriculumRevision, 'updateOne')
      .mockResolvedValue({ modifiedCount: 1 } as never),
    audit = vi.spyOn(AuditLog, 'create').mockResolvedValue([] as never);
  await mongoCurriculumRepository.transaction(async (tx) => {
    expect(tx.learning).toBeInstanceOf(MongoLearningUnit);
    await tx.touchDraft(newId(), 4);
    await tx.learning.students.admin.audit({
      actorUserId: newId(),
      actorName: 'Test editor',
      action: 'CURRICULUM_PUBLISHED',
      targetType: 'CURRICULUM',
      targetId: newId(),
      requestId: 'test',
      metadata: { count: 1 },
    });
  });
  expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
    readConcern: { level: 'snapshot' },
    writeConcern: { w: 'majority' },
  });
  expect(update).toHaveBeenCalledWith(
    expect.objectContaining({ status: 'DRAFT', revision: 4 }),
    { $inc: { revision: 1 } },
    expect.objectContaining({ session, runValidators: true }),
  );
  expect(audit).toHaveBeenCalledWith(
    expect.any(Array),
    expect.objectContaining({ session }),
  );
});
it('guards editorial CAS by DRAFT and expected revision', async () => {
  const session = {} as ClientSession,
    id = newId(),
    update = vi
      .spyOn(EditorialRevision, 'findOneAndUpdate')
      .mockResolvedValue(null);
  await new MongoCurriculumUnit(session).publishEditorial(id, 4, newId());
  expect(update).toHaveBeenCalledWith(
    { _id: id, status: 'DRAFT', revision: 4 },
    expect.objectContaining({ $inc: { revision: 1 } }),
    expect.objectContaining({ session }),
  );
});
it('reorders with unused positive temporary numbers even at Day one billion', async () => {
  const session = {} as ClientSession,
    id = newId(),
    a = newId(),
    b = newId(),
    unit = new MongoCurriculumUnit(session);
  vi.spyOn(CurriculumRevision, 'exists').mockReturnValue({
    session: async () => ({ _id: id }),
  } as never);
  vi.spyOn(unit, 'allDays').mockResolvedValue([
    { id: a, dayNumber: 1 },
    { id: b, dayNumber: 1000000000 },
  ] as never);
  const update = vi
    .spyOn(LearningDay, 'updateOne')
    .mockResolvedValue({ modifiedCount: 1 } as never);
  await unit.reorder(id, [b, a]);
  expect(
    update.mock.calls.map(
      ([, change]) =>
        (change as { $set: { dayNumber: number } }).$set.dayNumber,
    ),
  ).toEqual([3, 4, 1, 2]);
  expect(
    update.mock.calls.every(
      ([filter, , options]) =>
        filter.curriculumRevisionId === id && options?.session === session,
    ),
  ).toBe(true);
});
it('requires draft parent before writing snapshots', async () => {
  vi.spyOn(CurriculumRevision, 'exists').mockReturnValue({
    session: async () => null,
  } as never);
  const create = vi.spyOn(PublishedLearningDay, 'create');
  await expect(
    new MongoCurriculumUnit().freezeDay(newId(), {} as never),
  ).rejects.toMatchObject({ code: 'IMMUTABLE_CONTENT' });
  expect(create).not.toHaveBeenCalled();
});

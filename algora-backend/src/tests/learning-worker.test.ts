import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import mongoose, { type ClientSession } from 'mongoose';
import * as repository from '../learning/repository.js';
import { LearningService } from '../learning/service.js';
import { runReconciliationPass } from '../learning/worker.js';
import { User } from '../models/user.js';
import { College } from '../models/college.js';
import { StudentProfile } from '../models/student-profile.js';
import { Course, Batch } from '../models/learning.js';
import { newId } from './administration-fixtures.js';
const id = newId();
beforeEach(() => {
  vi.spyOn(repository, 'learningStorageReady').mockReturnValue(true);
  for (const model of [User, College, StudentProfile, Course, Batch])
    vi.spyOn(model, 'findOne').mockReturnValue({
      select: () => ({ lean: async () => null }),
    } as never);
});
afterEach(() => vi.restoreAllMocks());
function job(attempts = 0) {
  const marker = {
    _id: id,
    enrollmentReconciliationPending: true,
    reconciliationCursor: '',
    reconciliationAttempts: attempts,
    reconciliationToken: 'generation-one',
  };
  vi.mocked(User.findOne).mockReturnValue({
    select: () => ({ lean: async () => marker }),
  } as never);
  vi.spyOn(User, 'findById').mockReturnValue({
    session: () => ({ lean: async () => marker }),
    select: () => ({ lean: async () => marker }),
  } as never);
  return vi
    .spyOn(User, 'updateOne')
    .mockResolvedValue({ modifiedCount: 1 } as never);
}
it('processes a durable page and clears its marker only in the same transaction', async () => {
  const update = job(),
    session = {} as ClientSession;
  const transaction = vi
    .spyOn(mongoose.connection, 'transaction')
    .mockImplementation(async (work) => work(session));
  const rows = vi
      .spyOn(repository.MongoLearningUnit.prototype, 'reconciliationRows')
      .mockResolvedValue([]),
    reconcile = vi
      .spyOn(LearningService.prototype, 'reconcileRows')
      .mockResolvedValue();
  await runReconciliationPass();
  expect(rows).toHaveBeenCalledWith('USER', id, '');
  expect(reconcile).toHaveBeenCalledWith(
    expect.any(repository.MongoLearningUnit),
    [],
    expect.stringMatching(/^reconcile-/),
  );
  expect(update).toHaveBeenCalledWith(
    { _id: id },
    {
      $set: expect.objectContaining({
        enrollmentReconciliationPending: false,
        reconciliationCursor: '',
        reconciliationAttempts: 0,
      }),
    },
    { session },
  );
  expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
    readConcern: { level: 'snapshot' },
    writeConcern: { w: 'majority' },
  });
});
it('keeps a full page pending and stores its cursor for bounded continuation', async () => {
  const update = job();
  vi.spyOn(mongoose.connection, 'transaction').mockImplementation(
    async (work) => work({} as ClientSession),
  );
  const rows = Array.from({ length: 50 }, () => ({ id: newId() }));
  vi.spyOn(
    repository.MongoLearningUnit.prototype,
    'reconciliationRows',
  ).mockResolvedValue(rows as never);
  vi.spyOn(LearningService.prototype, 'reconcileRows').mockResolvedValue();
  await runReconciliationPass();
  expect(update).toHaveBeenCalledWith(
    { _id: id },
    {
      $set: expect.objectContaining({
        enrollmentReconciliationPending: true,
        reconciliationCursor: rows.at(-1)!.id,
      }),
    },
    expect.any(Object),
  );
});
it('persists bounded retry/failure visibility without overwriting a newer event generation', async () => {
  const update = job(7);
  vi.spyOn(mongoose.connection, 'transaction').mockRejectedValue(
    Error('sensitive driver diagnostic'),
  );
  const start = Date.now();
  await runReconciliationPass();
  expect(update).toHaveBeenCalledWith(
    { _id: id, reconciliationToken: 'generation-one' },
    {
      $set: expect.objectContaining({
        reconciliationAttempts: 8,
        reconciliationError:
          'Reconciliation failed; administrative retry or database repair required',
        reconciliationNextAt: expect.any(Date),
      }),
    },
  );
  const payload = update.mock.calls[0]![1] as {
    $set: { reconciliationNextAt: Date };
  };
  expect(payload.$set.reconciliationNextAt.getTime()).toBeGreaterThanOrEqual(
    start + 300000,
  );
  expect(JSON.stringify(update.mock.calls)).not.toContain(
    'sensitive driver diagnostic',
  );
  expect(User.findOne).toHaveBeenCalledWith(
    expect.objectContaining({ reconciliationAttempts: { $lt: 8 } }),
  );
});
it('does not run database work while readiness is unavailable', async () => {
  vi.mocked(repository.learningStorageReady).mockReturnValue(false);
  await runReconciliationPass();
  expect(User.findOne).not.toHaveBeenCalled();
});

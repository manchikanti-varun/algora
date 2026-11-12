import { afterEach, describe, it, expect, vi } from 'vitest';
import mongoose, { type ClientSession } from 'mongoose';
import {
  MongoAdminUnit,
  mongoAdminRepository,
  storageError,
} from '../administration/repository.js';
import { User } from '../models/user.js';
import { testUser } from './administration-fixtures.js';
afterEach(() => vi.restoreAllMocks());
describe('production transaction and promotion contracts', () => {
  it('uses a snapshot/majority MongoDB transaction and passes its session to the unit', async () => {
    vi.spyOn(mongoAdminRepository, 'ensureReady').mockResolvedValue();
    const session = {} as ClientSession;
    const transaction = vi
      .spyOn(mongoose.connection, 'transaction')
      .mockImplementation(async (work) => work(session));
    const result = await mongoAdminRepository.transaction(async (unit) => {
      expect(unit).toBeInstanceOf(MongoAdminUnit);
      return 'committed';
    });
    expect(result).toBe('committed');
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      readConcern: { level: 'snapshot' },
      writeConcern: { w: 'majority' },
    });
  });
  it('allocates an initial username only through a subject/version/role guarded update in the transaction', async () => {
    const u = testUser();
    const session = {} as ClientSession;
    const doc = new User({
      googleSubject: u.googleSubject,
      email: u.email,
      emailVerified: true,
      displayName: u.displayName,
      lastLoginAt: u.lastLoginAt,
      _id: u.id,
      role: 'ADMIN',
      username: 'ad-alicemorgan',
      accountStatus: 'ACTIVE',
    });
    const update = vi.spyOn(User, 'findOneAndUpdate').mockResolvedValue(doc);
    await new MongoAdminUnit(session).promote(
      u.id,
      u.googleSubject,
      'ad-alicemorgan',
      'ADMIN',
      0,
    );
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: u.id,
        googleSubject: u.googleSubject,
        emailVerified: true,
        role: 'STUDENT',
        username: { $exists: false },
        sessionVersion: 0,
      }),
      expect.objectContaining({
        $set: {
          role: 'ADMIN',
          username: 'ad-alicemorgan',
          accountStatus: 'ACTIVE',
        },
        $inc: { sessionVersion: 1 },
      }),
      expect.objectContaining({
        session,
        new: true,
        runValidators: true,
        overwriteImmutable: true,
      }),
    );
  });
  it('maps unique username conflicts without leaking driver key values', () => {
    expect(() =>
      storageError({
        code: 11000,
        keyPattern: { username: 1 },
        keyValue: { username: 'private-fixture' },
      }),
    ).toThrow('A unique record already exists');
    expect(() => storageError(Error('sensitive driver diagnostic'))).toThrow(
      'Administration is temporarily unavailable',
    );
  });
});

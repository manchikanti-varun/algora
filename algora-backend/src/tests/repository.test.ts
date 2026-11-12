import { afterEach, describe, it, expect, vi } from 'vitest';
import { User } from '../models/user.js';
import { Session } from '../models/session.js';
import { OAuthState } from '../models/oauth-transaction.js';
import { mongoAuthRepository } from '../auth/repository.js';
import { identity } from './auth-fixtures.js';
afterEach(() => vi.restoreAllMocks());
function document() {
  return new User({
    googleSubject: identity.sub,
    email: identity.email,
    emailVerified: true,
    displayName: identity.displayName,
    lastLoginAt: new Date(),
  });
}
describe('production MongoDB repository and schema contracts', () => {
  it('uses atomic subject upsert and hardcoded least privilege', async () => {
    const doc = document();
    const update = vi.spyOn(User, 'findOneAndUpdate').mockResolvedValue(doc);
    const result = await mongoAuthRepository.upsertGoogle({
      ...identity,
      ...{ role: 'SUPER_ADMIN' },
    });
    expect(result.role).toBe('STUDENT');
    expect(update).toHaveBeenCalledWith(
      { googleSubject: identity.sub },
      expect.objectContaining({
        $setOnInsert: expect.objectContaining({
          role: 'STUDENT',
          accountStatus: 'PENDING',
          registrationStatus: 'NOT_STARTED',
        }),
      }),
      expect.objectContaining({ upsert: true, runValidators: true }),
    );
  });
  it('recovers concurrent unique-subject collision without duplicate users', async () => {
    vi.spyOn(User, 'findOneAndUpdate').mockRejectedValue({ code: 11000 });
    const existing = document();
    vi.spyOn(User, 'findOne').mockResolvedValue(existing);
    expect((await mongoAuthRepository.upsertGoogle(identity)).id).toBe(
      existing._id.toString(),
    );
  });
  it('does not merge a different Google subject by email', async () => {
    vi.spyOn(User, 'findOneAndUpdate').mockRejectedValue({ code: 11000 });
    vi.spyOn(User, 'findOne').mockResolvedValue(null);
    await expect(
      mongoAuthRepository.upsertGoogle(identity),
    ).rejects.toMatchObject({ code: 'IDENTITY_CONFLICT' });
  });
  it('defines required unique identity and sparse username constraints', () => {
    const indexes = User.schema.indexes();
    expect(indexes).toEqual(
      expect.arrayContaining([
        [{ googleSubject: 1 }, expect.objectContaining({ unique: true })],
        [{ email: 1 }, expect.objectContaining({ unique: true })],
        [
          { username: 1 },
          expect.objectContaining({
            unique: true,
            partialFilterExpression: { username: { $type: 'string' } },
          }),
        ],
      ]),
    );
    expect(User.schema.path('username').options.immutable).toBe(true);
  });
  it('defines hashed session token uniqueness and TTL cleanup', () => {
    expect(Session.schema.indexes()).toEqual(
      expect.arrayContaining([
        [{ tokenHash: 1 }, expect.objectContaining({ unique: true })],
        [{ expiresAt: 1 }, expect.objectContaining({ expireAfterSeconds: 0 })],
      ]),
    );
    expect(OAuthState.schema.indexes()).toEqual(
      expect.arrayContaining([
        [{ stateHash: 1 }, expect.objectContaining({ unique: true })],
      ]),
    );
  });
  it('validates enums without a database', () => {
    const doc = document();
    doc.set('role', 'OWNER');
    expect(doc.validateSync()?.errors.role).toBeDefined();
  });
});

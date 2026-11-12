import { reconciliationPending } from '../learning/markers.js';
import mongoose from 'mongoose';
import { User, type UserDocument } from '../models/user.js';
import { Session, type SessionDocument } from '../models/session.js';
import { OAuthState } from '../models/oauth-transaction.js';
import { AppError } from '../middleware/errors.js';
import type { AuthRepository, UserRecord, SessionRecord } from './types.js';
let indexesReady = false;
mongoose.connection.on('disconnected', () => {
  indexesReady = false;
});
export const authStorageReady = () =>
  indexesReady && mongoose.connection.readyState === 1;
export async function initializeAuthIndexes() {
  indexesReady = false;
  await Promise.all([
    User.createIndexes(),
    Session.createIndexes(),
    OAuthState.createIndexes(),
  ]);
  indexesReady = true;
}
// Indexes are a correctness requirement, not merely a performance optimization.
export function userRecord(doc: UserDocument): UserRecord {
  return {
    id: doc._id.toString(),
    googleSubject: doc.googleSubject,
    email: doc.email,
    emailVerified: doc.emailVerified,
    displayName: doc.displayName,
    avatarUrl: doc.avatarUrl ?? undefined,
    role: doc.role,
    username: doc.username ?? undefined,
    accountStatus: doc.accountStatus,
    registrationStatus: doc.registrationStatus,
    sessionVersion: doc.sessionVersion,
    lastLoginAt: doc.lastLoginAt,
  };
}
function sessionRecord(doc: SessionDocument): SessionRecord {
  return {
    id: doc._id.toString(),
    userId: doc.userId.toString(),
    tokenHash: doc.tokenHash,
    version: doc.version,
    expiresAt: doc.expiresAt,
    revokedAt: doc.revokedAt ?? null,
    createdAt: doc.createdAt,
  };
}
export const mongoAuthRepository: AuthRepository = {
  async ensureReady() {
    if (mongoose.connection.readyState !== 1 || !indexesReady)
      throw new AppError(
        503,
        'AUTH_UNAVAILABLE',
        'Authentication is temporarily unavailable',
      );
  },
  async upsertGoogle(identity) {
    const update = {
      email: identity.email.toLowerCase(),
      emailVerified: true,
      displayName: identity.displayName,
      avatarUrl: identity.avatarUrl,
      lastLoginAt: new Date(),
    };
    try {
      const doc = await User.findOneAndUpdate(
        { googleSubject: identity.sub },
        {
          $set: update,
          $setOnInsert: {
            role: 'STUDENT',
            accountStatus: 'PENDING',
            registrationStatus: 'NOT_STARTED',
            sessionVersion: 0,
          },
        },
        {
          upsert: true,
          new: true,
          runValidators: true,
          setDefaultsOnInsert: true,
        },
      );
      return userRecord(doc);
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
      const existing = await User.findOne({ googleSubject: identity.sub });
      // Never link a different subject just because its email matches.
      if (!existing || existing.email !== identity.email.toLowerCase())
        throw new AppError(
          409,
          'IDENTITY_CONFLICT',
          'This identity cannot be linked automatically',
        );
      return userRecord(existing);
    }
  },
  async findUser(id) {
    const doc = await User.findById(id);
    return doc ? userRecord(doc) : null;
  },
  async createSession(session) {
    return sessionRecord(await Session.create(session));
  },
  async findSession(tokenHash) {
    const doc = await Session.findOne({ tokenHash });
    return doc ? sessionRecord(doc) : null;
  },
  async rotateSession(oldHash, newHash, now) {
    const doc = await Session.findOneAndUpdate(
      { tokenHash: oldHash, revokedAt: null, expiresAt: { $gt: now } },
      { $set: { tokenHash: newHash } },
      { new: true },
    );
    return doc ? sessionRecord(doc) : null;
  },
  async revokeSession(tokenHash) {
    await Session.updateOne(
      { tokenHash, revokedAt: null },
      { $set: { revokedAt: new Date() } },
    );
  },
  async revokeAll(userId) {
    await User.updateOne({ _id: userId }, { $inc: { sessionVersion: 1 } });
    await Session.updateMany(
      { userId, revokedAt: null },
      { $set: { revokedAt: new Date() } },
    );
  },
  async storeTransaction(transaction) {
    await OAuthState.create(transaction);
  },
  async consumeTransaction(stateHash, browserHash, now) {
    const doc = await OAuthState.findOneAndDelete({
      stateHash,
      browserHash,
      expiresAt: { $gt: now },
    });
    return doc
      ? {
          stateHash: doc.stateHash,
          browserHash: doc.browserHash,
          verifier: doc.verifier,
          nonce: doc.nonce,
          expiresAt: doc.expiresAt,
          intent: doc.intent,
        }
      : null;
  },
  async changeAccountStatus(id, expected, next) {
    const result = await User.updateOne(
      { _id: id, accountStatus: expected },
      {
        $set: { accountStatus: next, ...reconciliationPending() },
        $inc: { sessionVersion: 1 },
      },
      { runValidators: true },
    );
    return result.modifiedCount === 1;
  },
};

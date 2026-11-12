// Test-only repository. Never imported by production application modules.
import type {
  AuthRepository,
  UserRecord,
  SessionRecord,
  OAuthTransaction,
  GoogleIdentity,
  AccountStatus,
} from '../auth/types.js';
export class TestRepository implements AuthRepository {
  available = true;
  users = new Map<string, UserRecord>();
  sessions = new Map<string, SessionRecord>();
  transactions = new Map<string, OAuthTransaction>();
  async ensureReady() {
    if (!this.available) {
      const { AppError } = await import('../middleware/errors.js');
      throw new AppError(
        503,
        'AUTH_UNAVAILABLE',
        'Authentication is temporarily unavailable',
      );
    }
  }
  async upsertGoogle(identity: GoogleIdentity) {
    const found = [...this.users.values()].find(
      (u) => u.googleSubject === identity.sub,
    );
    if (found) return found;
    if ([...this.users.values()].some((u) => u.email === identity.email))
      throw Error('duplicate identity');
    const user: UserRecord = {
      id: 'user-' + this.users.size,
      googleSubject: identity.sub,
      email: identity.email,
      emailVerified: identity.emailVerified,
      displayName: identity.displayName,
      role: 'STUDENT',
      accountStatus: 'PENDING',
      registrationStatus: 'NOT_STARTED',
      sessionVersion: 0,
      lastLoginAt: new Date(),
    };
    this.users.set(user.id, user);
    return user;
  }
  async findUser(id: string) {
    return this.users.get(id) ?? null;
  }
  async createSession(data: Omit<SessionRecord, 'id' | 'createdAt'>) {
    const session = {
      ...data,
      id: 'session-' + this.sessions.size,
      createdAt: new Date(),
    };
    this.sessions.set(data.tokenHash, session);
    return session;
  }
  async findSession(hash: string) {
    return this.sessions.get(hash) ?? null;
  }
  async rotateSession(hash: string, next: string, now: Date) {
    const old = this.sessions.get(hash);
    if (!old || old.revokedAt || old.expiresAt <= now) return null;
    this.sessions.delete(hash);
    const session = { ...old, tokenHash: next };
    this.sessions.set(next, session);
    return session;
  }
  async revokeSession(hash: string) {
    const session = this.sessions.get(hash);
    if (session) session.revokedAt = new Date();
  }
  async revokeAll(id: string) {
    const user = this.users.get(id);
    if (user) user.sessionVersion++;
    for (const session of this.sessions.values())
      if (session.userId === id) session.revokedAt = new Date();
  }
  async storeTransaction(tx: OAuthTransaction) {
    this.transactions.set(tx.stateHash, tx);
  }
  async consumeTransaction(state: string, browser: string, now: Date) {
    const tx = this.transactions.get(state);
    if (!tx || tx.browserHash !== browser || tx.expiresAt <= now) return null;
    this.transactions.delete(state);
    return tx;
  }
  async changeAccountStatus(
    id: string,
    expected: AccountStatus,
    next: AccountStatus,
  ) {
    const user = this.users.get(id);
    if (!user || user.accountStatus !== expected) return false;
    user.accountStatus = next;
    user.sessionVersion++;
    return true;
  }
}
export const identity: GoogleIdentity = {
  sub: 'google-subject',
  email: 'learner@example.test',
  emailVerified: true,
  displayName: 'Example Learner',
};

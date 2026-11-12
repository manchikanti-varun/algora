import {
  randomBytes,
  createHash,
  createHmac,
  timingSafeEqual,
} from 'node:crypto';
import { AppError } from '../middleware/errors.js';
import type { AuthRepository, SessionRecord, UserRecord } from './types.js';
export const randomToken = () => randomBytes(32).toString('base64url');
export const hashToken = (token: string) =>
  createHash('sha256').update(token).digest('hex');
export const csrfFor = (tokenHash: string) =>
  createHmac('sha256', tokenHash).update('algora-csrf-v1').digest('base64url');
export function validCsrf(hash: string, supplied: unknown) {
  if (typeof supplied !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(supplied))
    return false;
  return timingSafeEqual(Buffer.from(csrfFor(hash)), Buffer.from(supplied));
}
export interface AuthContext {
  user: UserRecord;
  session: SessionRecord;
}
export class SessionService {
  constructor(
    private repo: AuthRepository,
    private ttlSeconds: number,
    private now = () => new Date(),
  ) {}
  async create(user: UserRecord) {
    await this.repo.ensureReady();
    if (['SUSPENDED', 'ARCHIVED'].includes(user.accountStatus))
      throw new AppError(
        403,
        'ACCOUNT_SUSPENDED',
        'This account is not available',
      );
    const token = randomToken();
    const session = await this.repo.createSession({
      userId: user.id,
      tokenHash: hashToken(token),
      version: user.sessionVersion,
      expiresAt: new Date(this.now().getTime() + this.ttlSeconds * 1000),
      revokedAt: null,
    });
    return { token, session };
  }
  async authenticate(token: string | undefined): Promise<AuthContext> {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token))
      throw new AppError(401, 'AUTH_REQUIRED', 'Please sign in to continue');
    await this.repo.ensureReady();
    const session = await this.repo.findSession(hashToken(token));
    if (!session || session.revokedAt)
      throw new AppError(
        401,
        'SESSION_EXPIRED',
        'Your session has ended. Please sign in again',
      );
    if (session.expiresAt <= this.now()) {
      await this.repo.revokeSession(session.tokenHash);
      throw new AppError(401, 'SESSION_EXPIRED', 'Your session has expired');
    }
    const user = await this.repo.findUser(session.userId);
    if (!user || user.sessionVersion !== session.version)
      throw new AppError(401, 'SESSION_EXPIRED', 'Your session has ended');
    if (['SUSPENDED', 'ARCHIVED'].includes(user.accountStatus)) {
      await this.repo.revokeAll(user.id);
      throw new AppError(
        403,
        'ACCOUNT_SUSPENDED',
        'This account is suspended or archived',
      );
    }
    return { user, session };
  }
  async rotate(context: AuthContext) {
    const token = randomToken();
    const session = await this.repo.rotateSession(
      context.session.tokenHash,
      hashToken(token),
      this.now(),
    );
    if (!session)
      throw new AppError(401, 'SESSION_EXPIRED', 'Your session has ended');
    return { token, session };
  }
  async logout(context: AuthContext) {
    await this.repo.revokeSession(context.session.tokenHash);
  }
  async logoutAll(context: AuthContext) {
    await this.repo.revokeAll(context.user.id);
  }
}

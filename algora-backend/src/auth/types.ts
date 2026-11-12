export const roles = ['SUPER_ADMIN', 'ADMIN', 'STUDENT'] as const;
export const accountStatuses = [
  'PENDING',
  'ACTIVE',
  'SUSPENDED',
  'ARCHIVED',
] as const;
export const registrationStatuses = [
  'NOT_STARTED',
  'INCOMPLETE',
  'PENDING_VERIFICATION',
  'VERIFIED',
] as const;
export type Role = (typeof roles)[number];
export type AccountStatus = (typeof accountStatuses)[number];
export type RegistrationStatus = (typeof registrationStatuses)[number];
export interface UserRecord {
  id: string;
  googleSubject: string;
  email: string;
  emailVerified: boolean;
  displayName: string;
  avatarUrl?: string;
  role: Role;
  username?: string;
  accountStatus: AccountStatus;
  registrationStatus: RegistrationStatus;
  sessionVersion: number;
  lastLoginAt: Date;
}
export interface GoogleIdentity {
  sub: string;
  email: string;
  emailVerified: boolean;
  displayName: string;
  avatarUrl?: string;
}
export interface SessionRecord {
  id: string;
  userId: string;
  tokenHash: string;
  version: number;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
}
export interface OAuthTransaction {
  intent?: 'DEFAULT' | 'ADMIN_ACCESS';
  stateHash: string;
  browserHash: string;
  verifier: string;
  nonce: string;
  expiresAt: Date;
}
export interface AuthRepository {
  ensureReady(): Promise<void>;
  upsertGoogle(identity: GoogleIdentity): Promise<UserRecord>;
  findUser(id: string): Promise<UserRecord | null>;
  createSession(
    session: Omit<SessionRecord, 'id' | 'createdAt'>,
  ): Promise<SessionRecord>;
  findSession(hash: string): Promise<SessionRecord | null>;
  rotateSession(
    oldHash: string,
    newHash: string,
    now: Date,
  ): Promise<SessionRecord | null>;
  revokeSession(hash: string): Promise<void>;
  revokeAll(userId: string): Promise<void>;
  storeTransaction(transaction: OAuthTransaction): Promise<void>;
  consumeTransaction(
    stateHash: string,
    browserHash: string,
    now: Date,
  ): Promise<OAuthTransaction | null>;
  changeAccountStatus(
    id: string,
    expected: AccountStatus,
    next: AccountStatus,
  ): Promise<boolean>;
}
export function publicUser(user: UserRecord) {
  return {
    id: user.id,
    email: user.email,
    emailVerified: user.emailVerified,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    role: user.role,
    username: user.username,
    accountStatus: user.accountStatus,
    registrationStatus: user.registrationStatus,
  };
}
export function destination(
  user: Pick<UserRecord, 'role' | 'accountStatus' | 'registrationStatus'>,
) {
  if (user.accountStatus === 'SUSPENDED' || user.accountStatus === 'ARCHIVED')
    return '/account-suspended';
  if (
    user.role === 'STUDENT' &&
    ['NOT_STARTED', 'INCOMPLETE'].includes(user.registrationStatus)
  )
    return '/student/register';
  if (
    user.role === 'STUDENT' &&
    user.registrationStatus === 'PENDING_VERIFICATION'
  )
    return '/student/profile';
  if (
    user.accountStatus !== 'ACTIVE' ||
    (user.role === 'STUDENT' && user.registrationStatus !== 'VERIFIED')
  )
    return '/account-pending';
  return user.role === 'SUPER_ADMIN'
    ? '/super-admin'
    : user.role === 'ADMIN'
      ? '/admin'
      : '/student';
}

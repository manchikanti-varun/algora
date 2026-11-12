import { AppError } from '../middleware/errors.js';
import type {
  AccountStatus,
  AuthRepository,
  RegistrationStatus,
} from './types.js';
const transitions: Record<AccountStatus, readonly AccountStatus[]> = {
  PENDING: ['ACTIVE', 'SUSPENDED', 'ARCHIVED'],
  ACTIVE: ['SUSPENDED', 'ARCHIVED'],
  SUSPENDED: ['ACTIVE', 'ARCHIVED'],
  ARCHIVED: [],
};
const registration: Record<RegistrationStatus, readonly RegistrationStatus[]> =
  {
    NOT_STARTED: ['INCOMPLETE'],
    INCOMPLETE: ['PENDING_VERIFICATION'],
    PENDING_VERIFICATION: ['INCOMPLETE', 'VERIFIED'],
    VERIFIED: [],
  };
export function assertRegistrationTransition(
  from: RegistrationStatus,
  to: RegistrationStatus,
) {
  if (!registration[from].includes(to))
    throw new AppError(
      409,
      'INVALID_TRANSITION',
      'Registration transition is not allowed',
    );
}
// Internal utility only. No approval, registration or role-changing HTTP endpoints exist.
export async function transitionAccount(
  repo: AuthRepository,
  id: string,
  from: AccountStatus,
  to: AccountStatus,
) {
  if (!transitions[from].includes(to))
    throw new AppError(
      409,
      'INVALID_TRANSITION',
      'Account transition is not allowed',
    );
  await repo.ensureReady();
  if (!(await repo.changeAccountStatus(id, from, to)))
    throw new AppError(
      409,
      'ACCOUNT_CHANGED',
      'Account state changed; retry safely',
    );
  if (to === 'SUSPENDED' || to === 'ARCHIVED') await repo.revokeAll(id);
}
